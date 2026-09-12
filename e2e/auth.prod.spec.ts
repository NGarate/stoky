import { test, expect } from "@playwright/test";
import { DEMO_EMAIL, DEMO_PASSWORD } from "./session";

/**
 * Authentication, under a real production build.
 *
 * This exists because production auth was **completely broken** and every suite
 * was green. Auth.js v5 defaults `trustHost` to false off Vercel and then
 * refuses any request whose Host it cannot vouch for — `UntrustedHost`, a 500
 * from `/api/auth/session`, nobody able to sign in. Setting `NEXTAUTH_URL`
 * correctly does not help; it was verified against a build whose `NEXTAUTH_URL`
 * matched the server's own address exactly.
 *
 * Nothing noticed because `next dev` does not apply the check, and every other
 * suite runs against `next dev`. So the guard has to live here, in the one
 * config that serves the standalone artefact the image runs.
 */

test.describe("a production build's authentication", () => {
  test("answers the session endpoint instead of refusing the host", async ({
    request,
  }) => {
    // The exact call that returned 500 `UntrustedHost`. `null` is the right
    // answer for a request with no cookie; what matters is that it is answered.
    const response = await request.get("/api/auth/session");

    expect(response.status()).toBe(200);
    expect(await response.json()).toBeNull();
  });

  test("issues a CSRF token, which sign-in cannot proceed without", async ({
    request,
  }) => {
    const response = await request.get("/api/auth/csrf");

    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty("csrfToken");
  });

  test("serves the login page", async ({ page }) => {
    // Cheap, and it distinguishes "auth is broken" from "the server is down" if
    // the two above ever fail together.
    await page.goto("/login");

    await expect(page.locator("form")).toBeVisible();
  });
});

/**
 * The journey, rather than the endpoints.
 *
 * The three tests above prove Auth.js answers. This proves a person can get in
 * — against the standalone artefact, under the production Content-Security
 * Policy, which is a stricter policy than any other suite ever exercises: no
 * `unsafe-eval`, no websocket origins, and `upgrade-insecure-requests` on top.
 * A policy that blocks the framework's own scripts produces a login form that
 * renders and does nothing, which is precisely the failure mode that hid the
 * `trustHost` defect.
 */
test("somebody can actually sign in", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/login");
  await page.waitForSelector('input[name="email"]');
  // Let the client hydrate: a pre-hydration submit falls back to a native POST.
  await page.waitForTimeout(1500);

  await page.fill('input[name="email"]', DEMO_EMAIL);
  await page.fill('input[name="password"]', DEMO_PASSWORD);
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.locator("main:visible")).toBeVisible();
  // Instant validation reports asynchronously over the dev HMR websocket,
  // which networkidle does not wait for. Keep observing errors for a bounded
  // window after the dashboard renders; otherwise this test can finish before
  // the validation error arrives (verified with instant = true on the layout).
  await page.waitForTimeout(5000);

  // A CSP violation surfaces here and nowhere else — the page still renders,
  // it just stops working. Reported as its own assertion so a policy problem
  // does not masquerade as a broken login.
  const violations = browserErrors.filter((text) =>
    /content security policy|refused to (execute|load|connect)/i.test(text),
  );
  expect(violations).toEqual([]);

  // Also exercised against next dev when investigating navigation validation:
  // a successful HTTP response and URL change can still carry an Instant
  // error from the authenticated layout's server-side request reads.
  expect(browserErrors.filter((text) =>
    /uncached data during prerendering|blocking-prerender-dynamic/.test(text),
  )).toEqual([]);
});
