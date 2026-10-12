import { test, expect } from "@playwright/test";

/**
 * The tRPC endpoint refuses a request another page sent, against the real
 * server — `src/server/http/trpc-handler.ts`.
 *
 * The unit test drives the handler with a stand-in router. This drives the
 * production build with a real session at the one procedure the guard exists
 * for: `auth.revokeMySessions` takes no input, so before the guard a form on a
 * sibling subdomain could sign a household out of every device by posting to
 * it.
 *
 * **The last request is the control.** The refused requests are the same
 * request with one header changed, so the test finishes by sending it with
 * `same-origin` and showing that it does revoke. Without that, a 403 and a
 * session still alive afterwards are equally well explained by a request that
 * never named a working procedure at all.
 *
 * **Its own account, registered here**, for the reason
 * `session-revocation.spec.ts` gives: revoking the shared demo session would
 * sign the rest of the run out — and a guard that let the forged request
 * through would do exactly that.
 *
 * Not `@smoke`, so chromium alone runs it: Fetch Metadata here is a header the
 * test sets, not one an engine chooses, and the server's answer to it has one
 * value.
 */

const PASSWORD = "E2EGuards123!";
const REVOKE = "/api/trpc/auth.revokeMySessions";

function freshEmail(): string {
  const worker = test.info().parallelIndex;
  return `guards.w${worker}.${Date.now()}.${Math.random()
    .toString(36)
    .substring(7)}@example.com`;
}

test("a cross-site or form-encoded call is refused and the session survives it", async ({
  page,
}) => {
  const stamp = Date.now();

  // ---------------------------------------------------------------- given --
  await page.goto("/register");
  await page.waitForSelector('input[name="email"]');
  // Hydration: a pre-hydration submit falls back to a native POST.
  await page.waitForTimeout(1500);
  await page.fill('input[name="name"]', `Guards E2E ${stamp}`);
  await page.fill('input[name="email"]', freshEmail());
  await page.fill('input[name="password"]', PASSWORD);
  const householdField = page.locator('input[name="householdName"]');
  if (await householdField.count()) {
    await householdField.fill(`Guards Household ${stamp}`);
  }
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });

  // ----------------------------------------------------------------- when --
  // `page.request` carries this context's session cookie, as a forged
  // request from a sibling subdomain would under SameSite=Lax.
  const crossSite = await page.request.post(REVOKE, {
    headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
    data: "{}",
  });
  expect(crossSite.status(), "a call another site sent reached tRPC").toBe(403);

  // What an HTML form posts, with no Fetch Metadata to refuse it on.
  const form = await page.request.post(REVOKE, { multipart: { anything: "1" } });
  expect(form.status(), "a form-encoded call reached tRPC").toBe(415);

  // ----------------------------------------------------------------- then --
  await page.goto("/dashboard");
  await expect(
    page,
    "the session was revoked by a request the endpoint should have refused",
  ).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  // -------------------------------------------------------------- control --
  const sameOrigin = await page.request.post(REVOKE, {
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    data: "{}",
  });
  expect(sameOrigin.status()).toBe(200);
  await page.goto("/dashboard");
  await expect(
    page,
    "the same request from this origin did not revoke, so the refusals above " +
      "prove nothing about the guard",
  ).toHaveURL(/\/login/, { timeout: 30_000 });
});
