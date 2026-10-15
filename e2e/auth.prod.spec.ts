import { test, expect } from "@playwright/test";
import es from "../messages/es.json";
import { DEMO_EMAIL, DEMO_PASSWORD } from "./session";

/**
 * Authentication, under a real production build.
 *
 * This exists because production auth was once **completely broken** while
 * every suite was green: Auth.js v5 refused any request whose Host it could not
 * vouch for — a 500 from its session endpoint, nobody able to sign in — and
 * `next dev`, which every other suite ran against, did not apply the check. So
 * the guard lives here, in the one config that serves the standalone artefact
 * the image runs, and it outlived the library: Better Auth builds its
 * configuration once, from `STOKY_URLS`, and a production build is where a
 * mistake in that would show (PROGRESS D135, D138).
 */

test.describe("a production build's authentication", () => {
  test("answers the session endpoint instead of refusing the host", async ({
    request,
  }) => {
    // `null` is the right answer for a request with no cookie; what matters is
    // that it is answered.
    const response = await request.get("/api/auth/get-session");

    expect(response.status()).toBe(200);
    expect(await response.json()).toBeNull();
  });

  test("refuses a sign-in from a foreign origin when a cookie rides along", async ({
    request,
  }) => {
    // Better Auth's origin check, which it switches off under NODE_ENV=test
    // unless told not to. A browser that already holds a cookie for this
    // instance is exactly the one another page could make post here.
    const response = await request.post("/api/auth/sign-in/email", {
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        cookie: "stoky_device=00000000-0000-4000-8000-000000000000",
      },
      data: JSON.stringify({ email: DEMO_EMAIL, password: "no es la contraseña" }),
    });

    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ code: "INVALID_ORIGIN" });
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
 * The three tests above prove the auth API answers. This proves a person can get in
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

  // `/start`: a fresh context is a device nobody has chosen a screen on, and
  // signing in goes through `/`, which asks (Journey 8). The landing redirect
  // is a server component reading the session — under this CSP too.
  await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });
  // Answering it is a server action, and it lands on the authenticated shell
  // this test has always ended on.
  await page.getByRole("button", { name: new RegExp(es.start.dashboard) }).click();
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
