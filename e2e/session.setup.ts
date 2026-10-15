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
 * The session is a browser session: its row ends fifteen minutes after it was
 * last slid, and only the keep-alive's `auth.session` slides it
 * (`src/lib/auth/session-policy.ts`), which a test rarely waits long enough to
 * trigger. So the cookie saved here goes stale about 15 minutes after this
 * runs. That is the second reason the `globalTimeout` in `playwright.config.ts`
 * is a ceiling and not an estimate: a run that outlasts it would also start
 * failing as "signed out" and report it as an application defect.
 */
setup("sign in", async ({ page }) => {
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]');
  // Let the client hydrate: a pre-hydration submit falls back to a native POST.
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', DEMO_EMAIL);
  await page.fill('input[name="password"]', DEMO_PASSWORD);
  await page.click('button[type="submit"]');

  // `/start`: signing in lands on `/`, and this context is a device the demo
  // account has never chosen a screen on, so it is asked (Journey 8). Nothing
  // is chosen here — the suites that reuse this session go where they mean to.
  await expect(
    page,
    `Could not sign in as ${DEMO_EMAIL}. The demo account comes from the seed — ` +
      "run `bun run db:seed` and try again.",
  ).toHaveURL(/\/start/, { timeout: 30_000 });

  await page.context().storageState({ path: SESSION_FILE });
});
