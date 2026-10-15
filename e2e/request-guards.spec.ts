import { test, expect } from "@playwright/test";

/**
 * The tRPC endpoint refuses a request another page sent, against the real
 * server — `src/server/http/trpc-handler.ts`.
 *
 * The unit test drives the handler with a stand-in router. This drives the
 * production build with a real session at the procedure the guard was
 * written for: `auth.revokeMySessions` took no input, so before the guard a
 * form on a sibling subdomain could sign a household out of every device by
 * posting to it. Its successor, `auth.endSessions`, asks for the password —
 * so the requests below carry the right one, and the only thing between a
 * forged request and every session ending is the handler. (A form's 415 is
 * the handler's too, before the body is read.)
 *
 * **The last request is the control.** The refused requests are the same
 * request with one header changed, so the test finishes by sending it with
 * `same-origin` and showing that it does end the session. Without that, a 403
 * and a session still alive afterwards are equally well explained by a
 * request that never named a working procedure, or a wrong password.
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
const END_ALL = "/api/trpc/auth.endSessions";
/** Every session, with the right password: superjson's envelope, as the client sends it. */
const END_ALL_BODY = JSON.stringify({ json: { currentPassword: PASSWORD, scope: "all" } });

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
  const crossSite = await page.request.post(END_ALL, {
    headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
    data: END_ALL_BODY,
  });
  expect(crossSite.status(), "a call another site sent reached tRPC").toBe(403);

  // What an HTML form posts, with no Fetch Metadata to refuse it on.
  const form = await page.request.post(END_ALL, {
    multipart: { currentPassword: PASSWORD, scope: "all" },
  });
  expect(form.status(), "a form-encoded call reached tRPC").toBe(415);

  // ----------------------------------------------------------------- then --
  // Asked of the server rather than read off the address bar: a signed-out
  // `goto("/dashboard")` lands on the prerendered shell before it goes to
  // `/login`, so the URL alone would pass either way.
  const session = await page.request.get("/api/auth/get-session");
  expect(
    await session.json(),
    "the session was ended by a request the endpoint should have refused",
  ).not.toBeNull();

  // -------------------------------------------------------------- control --
  const sameOrigin = await page.request.post(END_ALL, {
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    data: END_ALL_BODY,
  });
  expect(sameOrigin.status()).toBe(200);
  expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
  await page.goto("/dashboard");
  await expect(
    page,
    "the same request from this origin did not end the session, so the refusals above " +
      "prove nothing about the guard",
  ).toHaveURL(/\/login/, { timeout: 30_000 });
});
