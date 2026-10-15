import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import es from "../messages/es.json";

/**
 * Ending sessions from **Tus dispositivos**, through two browsers, against the
 * real server (PROGRESS D143).
 *
 * Three pieces of this already have tests and none of them touches the other
 * two. `integration/session.revocation.test.ts` signs in through the auth route
 * and proves a cookie stops being read once its row is deleted.
 * `components/EndSession.test.tsx` and `DeviceList.test.tsx` prove the screen's
 * order and its asking with the server mocked. Nothing proved the chain: that
 * pressing the button in a real browser, with the password, reaches
 * `auth.endSessions`, deletes the right rows, and makes an already-issued
 * cookie in *another* browser stop working.
 *
 * **Two sign-ins, two sessions.** The second browser signs in on its own, as a
 * second device does, so the list holds two rows and "this one" and "the other
 * one" are different sessions — not one cookie copied into two contexts,
 * which "end the other one" could not tell apart.
 *
 * **The control case is the point.** The second browser is shown to work
 * *before* the ending and to be refused *after* it; and when only the other
 * one is ended, this one is shown to still work. One assertion is the
 * treatment; the other is what makes it evidence rather than a coincidence.
 *
 * **Asked of the server, not read off the address bar.** A signed-out
 * `page.goto("/dashboard")` first lands on `/dashboard` — the prerendered
 * shell — and only then goes to `/login`, so `toHaveURL(/\/dashboard/)` passed
 * against a build whose "end this one session" ended every one. Measured, by
 * making that break. Each browser's state is therefore `get-session`'s answer
 * to its own cookies: a session, or `null`.
 *
 * **Its own account, registered here.** Every signed-in suite shares the demo
 * session from `session.setup.ts`; ending it would sign the rest of the run
 * out, which is ISSUES.md TEST-3's class — a test that consumes state another
 * test needs. This one starts signed out, which is Playwright's default, and
 * makes an account nothing else uses.
 *
 * Chromium only, via `CHROMIUM_ONLY` in `playwright.config.ts`: whether a
 * server refuses a token has one engine's answer.
 */

const PASSWORD = "E2ERevocation123!";
const t = es.security;

/** Unique per worker and per run, so two runs cannot collide on the address. */
function freshEmail(): string {
  const worker = test.info().parallelIndex;
  return `revoke.w${worker}.${Date.now()}.${Math.random()
    .toString(36)
    .substring(7)}@example.com`;
}

async function register(page: Page): Promise<string> {
  const email = freshEmail();
  const stamp = Date.now();
  await page.goto("/register");
  await page.waitForSelector('input[name="email"]');
  // Hydration: a pre-hydration submit falls back to a native POST, the same
  // reason `session.setup.ts` waits here.
  await page.waitForTimeout(1500);
  await page.fill('input[name="name"]', `Revoke E2E ${stamp}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  const householdField = page.locator('input[name="householdName"]');
  if (await householdField.count()) {
    await householdField.fill(`Revoke Household ${stamp}`);
  }
  await page.click('button[type="submit"]');
  // A new account is asked which screen it wants (Journey 8).
  await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });
  return email;
}

/** Whether the server reads this browser's cookies as a session. */
async function signedIn(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/auth/get-session");
  expect(response.status()).toBe(200);
  return (await response.json()) !== null;
}

/** A second device: its own browser, signing in with the form. */
async function secondDevice(
  browser: Browser,
  email: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]');
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });

  // The control. Without this the assertions after the ending are equally
  // well explained by this browser never having been signed in.
  expect(
    await signedIn(page),
    "the second browser was not signed in before anything was ended, " +
      "so the assertions after it would prove nothing",
  ).toBe(true);
  return { context, page };
}

/** Open the devices list and wait for both sessions to be on it. */
async function devices(page: Page): Promise<void> {
  await page.goto("/settings/security");
  await expect(page.getByRole("heading", { name: t.devicesTitle })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: t.endOthers })).toBeVisible({
    timeout: 30_000,
  });
}

/** Type the password into the open dialog and press its button. */
async function confirm(page: Page, button: string, password = PASSWORD): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(es.reauth.password).fill(password);
  await dialog.getByRole("button", { name: button, exact: true }).click();
}

test.describe("ending sessions from the devices list", () => {
  test("ends the other device's session, and this one stays", async ({ page, browser }) => {
    const email = await register(page);
    const other = await secondDevice(browser, email);

    // ----------------------------------------------------------------- when --
    await devices(page);
    // The row that is not this one: both are the same browser on the same
    // system, so the badge is what tells them apart.
    const otherRow = page
      .getByRole("region", { name: t.devicesTitle })
      .getByRole("listitem")
      .filter({ hasNot: page.getByText(t.thisDevice, { exact: true }) });
    await expect(otherRow).toHaveCount(1);
    await otherRow.getByRole("button", { name: new RegExp(`^${t.endOne}`) }).click();
    await confirm(page, t.endOne);
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });

    // ----------------------------------------------------------------- then --
    // The other browser, which never pressed anything, is refused.
    expect(
      await signedIn(other.page),
      "the other browser was still signed in after its session was ended",
    ).toBe(false);
    await other.page.goto("/dashboard");
    await expect(other.page).toHaveURL(/\/login/, { timeout: 30_000 });

    // This one is not: ending the other must not end the one asking.
    expect(await signedIn(page), "ending the other session signed this one out").toBe(true);

    await other.context.close();
  });

  test("ends every session with the password, both browsers included", async ({
    page,
    browser,
  }) => {
    const email = await register(page);
    const other = await secondDevice(browser, email);

    // ----------------------------------------------------------------- when --
    await devices(page);
    await page.getByRole("button", { name: t.endAll, exact: true }).click();
    await confirm(page, t.endAll);

    // ----------------------------------------------------------------- then --
    // This tab, which "every one" includes and the dialog said so.
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

    expect(await signedIn(page), "this browser was still signed in after every session ended").toBe(
      false,
    );
    expect(
      await signedIn(other.page),
      "the other browser was still signed in after every session was ended — " +
        "the button signed this tab out without the server ending anything",
    ).toBe(false);

    await other.context.close();
  });

  test("a wrong password ends nothing", async ({ page }) => {
    await register(page);

    await page.goto("/settings/security");
    await page.getByRole("button", { name: t.endAll, exact: true }).click();
    await confirm(page, t.endAll, "not the password at all");

    // Scoped to the dialog: the sync indicator keeps an empty alert region on
    // every dashboard page.
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(es.reauth.wrong, {
      timeout: 30_000,
    });
    await page.getByRole("dialog").getByRole("button", { name: es.common.cancel }).click();

    // Still signed in, and still on the page they were reading.
    await expect(page).toHaveURL(/\/settings\/security/);
    expect(await signedIn(page), "a wrong password ended the session").toBe(true);
  });
});
