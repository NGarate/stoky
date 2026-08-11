import { test, expect } from "@playwright/test";

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
