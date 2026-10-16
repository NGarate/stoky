import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import es from "../messages/es.json";

/**
 * "Mantener la sesión iniciada", through a real browser against the real
 * server (PROGRESS D141).
 *
 * `integration/session.policy.test.ts` proves the row and the `Set-Cookie`
 * line. What only a browser can say is what it then keeps: a session cookie
 * that dies with the browser when the box is left alone, and one that lives
 * about ninety days when it is ticked — and that the form's box, as a person
 * ticks it, is what decides between them.
 *
 * **Its own account, registered here**, like `session-revocation.spec.ts`:
 * the shared demo session must stay a browser session for the suites that
 * reuse it (`session.setup.ts`), and signing it in again here would replace
 * it (D139).
 *
 * Chromium only, via `CHROMIUM_ONLY` in `playwright.config.ts`: how long a
 * server tells a browser to keep a cookie has one engine's answer.
 */

const PASSWORD = "E2ERememberMe123!";
const DAY_S = 24 * 60 * 60;

function freshEmail(): string {
  const worker = test.info().parallelIndex;
  return `remember.w${worker}.${Date.now()}.${Math.random()
    .toString(36)
    .substring(7)}@example.com`;
}

async function register(page: Page, email: string): Promise<void> {
  const stamp = Date.now();
  await page.goto("/register");
  await page.waitForSelector('input[name="email"]');
  // Hydration: a pre-hydration submit falls back to a native POST.
  await page.waitForTimeout(1500);
  await page.fill('input[name="name"]', `Remember E2E ${stamp}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  const householdField = page.locator('input[name="householdName"]');
  if (await householdField.count()) {
    await householdField.fill(`Remember Household ${stamp}`);
  }
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });
}

async function sessionCookie(context: BrowserContext) {
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name.endsWith("session_token"));
  expect(session, "no session cookie after signing in").toBeDefined();
  return { session: session!, all: cookies };
}

test.describe("keep me signed in", () => {
  test("left alone, the browser keeps a session cookie; ticked, about ninety days", async ({
    page,
    browser,
  }) => {
    const email = freshEmail();

    // Registering signs in for a browser session: no expiry on the cookie,
    // so it goes when the browser closes.
    await register(page, email);
    const unticked = await sessionCookie(page.context());
    expect(unticked.session.expires, "an unticked sign-in set an expiring cookie").toBe(-1);

    // Another browser, signing in with the box ticked.
    const other = await browser.newContext();
    try {
      const kitchen = await other.newPage();
      await kitchen.goto("/login");
      await kitchen.waitForSelector('input[name="email"]');
      await kitchen.waitForTimeout(1500);
      const box = kitchen.getByRole("checkbox", { name: es.auth.rememberMe });
      await expect(box, "the box must start unticked").not.toBeChecked();

      await kitchen.fill('input[name="email"]', email);
      await kitchen.fill('input[name="password"]', PASSWORD);
      await box.check();
      const signedInAt = Date.now() / 1000;
      await kitchen.click('button[type="submit"]');
      await expect(kitchen).toHaveURL(/\/start/, { timeout: 30_000 });

      const ticked = await sessionCookie(other);
      const lifetime = ticked.session.expires - signedInAt;
      expect(lifetime).toBeGreaterThan(90 * DAY_S - 120);
      expect(lifetime).toBeLessThan(90 * DAY_S + 120);
      // Nothing left behind that would have Better Auth treat it as a
      // browser session.
      expect(ticked.all.some((cookie) => cookie.name.endsWith("dont_remember"))).toBe(false);

      // The kitchen screen's settings say how it should be signed in.
      await kitchen.goto("/settings/screen");
      await expect(kitchen.getByText(es.start.kitchenSignIn)).toBeVisible({ timeout: 30_000 });
    } finally {
      await other.close();
    }
  });
});
