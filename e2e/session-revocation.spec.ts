import { test, expect } from "@playwright/test";

/**
 * Ending every session, through the browser, against the real server.
 *
 * Three pieces of this already have tests and none of them touches the other
 * two. `integration/session.revocation.test.ts` drives the `jwt` callback
 * directly and proves it returns `null` for a token issued before the line.
 * `components/EndSession.test.tsx` proves the control's ordering with the
 * server mocked. Nothing proved the chain: that pressing the button in a real
 * browser reaches `auth.revokeMySessions`, writes `sessionsValidFrom`, and
 * makes an already-issued cookie stop working.
 *
 * **The control case is the point.** A test that only pressed the button and
 * checked it landed on `/login` would pass with the mutation that matters most
 * — a `revokeMySessions` that writes nothing, leaving the button as a
 * decorated sign-out while every other device stayed live. So a second browser
 * context carries the same session cookie and is shown to work *before* the
 * revocation and to be refused *after* it. One assertion is the treatment; the
 * other is what makes it evidence rather than a coincidence.
 *
 * **Its own account, registered here.** Every signed-in suite shares the demo
 * session from `session.setup.ts`; revoking it would sign the rest of the run
 * out, which is ISSUES.md TEST-3's class — a test that consumes state another
 * test needs. This one starts signed out, which is Playwright's default, and
 * makes an account nothing else uses.
 *
 * Chromium only, via `CHROMIUM_ONLY` in `playwright.config.ts`: whether a
 * server refuses a token has one engine's answer.
 */

const PASSWORD = "E2ERevocation123!";

/** Unique per worker and per run, so two runs cannot collide on the address. */
function freshEmail(): string {
  const worker = test.info().parallelIndex;
  return `revoke.w${worker}.${Date.now()}.${Math.random()
    .toString(36)
    .substring(7)}@example.com`;
}

test.describe("ending every session", () => {
  test("stops a cookie that was already issued, and not only this tab", async ({
    page,
    browser,
  }) => {
    const email = freshEmail();
    const stamp = Date.now();

    // ---------------------------------------------------------------- given --
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
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    // A second device, holding the very same session.
    const state = await page.context().storageState();
    const other = await browser.newContext({ storageState: state });
    const otherPage = await other.newPage();

    // The control. Without this the assertion at the end is equally well
    // explained by the cookie never having worked in this second context.
    await otherPage.goto("/dashboard");
    await expect(
      otherPage,
      "the second context could not reach the dashboard before the revocation, " +
        "so the assertion after it would prove nothing",
    ).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    // ----------------------------------------------------------------- when --
    await page.goto("/settings");
    await page
      .getByRole("button", { name: "Cerrar la sesión en todos los dispositivos" })
      .click();
    const confirm = page.getByRole("group", {
      name: "¿Cerrar la sesión en todos los dispositivos?",
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Sí, cerrarlas todas" }).click();

    // ----------------------------------------------------------------- then --
    // This tab, which the revocation includes and the confirmation said so.
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

    // The other device, which never pressed anything. Its cookie is unchanged
    // and is refused by the server, which is the whole claim.
    await otherPage.goto("/dashboard");
    await expect(
      otherPage,
      "the second context still reached the dashboard after revoking — the " +
        "button signed this tab out without the server invalidating anything",
    ).toHaveURL(/\/login/, { timeout: 30_000 });

    await other.close();
  });

  test("asks first, and the answer no leaves the session alone", async ({ page }) => {
    const email = freshEmail();
    const stamp = Date.now();

    await page.goto("/register");
    await page.waitForSelector('input[name="email"]');
    await page.waitForTimeout(1500);
    await page.fill('input[name="name"]', `Revoke Cancel ${stamp}`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    const householdField = page.locator('input[name="householdName"]');
    if (await householdField.count()) {
      await householdField.fill(`Revoke Cancel Household ${stamp}`);
    }
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    await page.goto("/settings");
    await page
      .getByRole("button", { name: "Cerrar la sesión en todos los dispositivos" })
      .click();
    await page
      .getByRole("group", { name: "¿Cerrar la sesión en todos los dispositivos?" })
      .getByRole("button", { name: "Seguir aquí" })
      .click();

    // Still signed in, and still on the page they were reading.
    await expect(page).toHaveURL(/\/settings/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  });
});
