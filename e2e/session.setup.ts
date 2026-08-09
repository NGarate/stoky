import { expect, test as setup } from "@playwright/test";
import { DEMO_EMAIL, DEMO_PASSWORD, SESSION_FILE } from "./session";

/**
 * Signs in once and saves the cookies for every signed-in suite to reuse.
 *
 * This is the only place left that drives the login form for the sake of getting
 * past it. The form itself is still tested end to end — `critical-paths.spec.ts`
 * registers an account and signs in with it, and `screen-reader.spec.ts` walks
 * the whole sign-in journey including a refusal — but those tests are about
 * login, and they run signed out.
 *
 * The session is a JWT with a 15 minute `maxAge` and no rolling refresh
 * (`src/lib/auth.ts`), so the cookie saved here goes stale 15 minutes after this
 * runs. That is the second reason the 10 minute `globalTimeout` in
 * `playwright.config.ts` is a ceiling and not an estimate: a run that outlasts
 * the budget would also start failing as "signed out" and report it as an
 * application defect.
 */
setup("sign in", async ({ page }) => {
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]');
  // Let the client hydrate: a pre-hydration submit falls back to a native POST.
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', DEMO_EMAIL);
  await page.fill('input[name="password"]', DEMO_PASSWORD);
  await page.click('button[type="submit"]');

  await expect(
    page,
    `Could not sign in as ${DEMO_EMAIL}. The demo account comes from the seed — ` +
      "run `corepack pnpm db:seed` and try again.",
  ).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  await page.context().storageState({ path: SESSION_FILE });
});
