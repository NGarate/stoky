import { test, expect, type Page } from "@playwright/test";

/**
 * Changing your own password, through the browser, against the real server.
 *
 * `integration/auth.flow.test.ts` proves the procedure: a wrong current
 * password changes nothing, a right one replaces the hash, and a token issued
 * before the change is refused. `components/EndSession.test.tsx` proves the
 * form's order with the server mocked. Neither proves the chain a person
 * actually depends on: that the form on `/settings` reaches
 * `auth.changePassword`, that the session ends, and that **the old password no
 * longer signs in while the new one does** — the whole point of rotating a
 * password somebody else may know.
 *
 * The old password is tried first and refused, then the new one is accepted.
 * The refusal alone would pass with a change that broke the account; the
 * acceptance alone would pass with a change that wrote nothing. Together they
 * are the claim.
 *
 * **Its own account, registered here**, for `session-revocation.spec.ts`'s
 * reason: the change ends every session the account has, and every other
 * signed-in suite shares the demo account's.
 *
 * Chromium only, via `CHROMIUM_ONLY` in `playwright.config.ts`: whether a
 * server accepts a password has one engine's answer.
 */

const OLD_PASSWORD = "E2EPasswordOld123!";
const NEW_PASSWORD = "tarro de garbanzos azul";

/** Unique per worker and per run, so two runs cannot collide on the address. */
function freshEmail(): string {
  const worker = test.info().parallelIndex;
  return `pwchange.w${worker}.${Date.now()}.${Math.random()
    .toString(36)
    .substring(7)}@example.com`;
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]');
  // Hydration: a pre-hydration submit falls back to a native POST, the same
  // reason `session.setup.ts` waits here.
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
}

test.describe("changing your own password", () => {
  test("signs this device out, refuses the old password and accepts the new one", async ({
    page,
  }) => {
    const email = freshEmail();
    const stamp = Date.now();

    // ---------------------------------------------------------------- given --
    await page.goto("/register");
    await page.waitForSelector('input[name="email"]');
    await page.waitForTimeout(1500);
    await page.fill('input[name="name"]', `Password E2E ${stamp}`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', OLD_PASSWORD);
    const householdField = page.locator('input[name="householdName"]');
    if (await householdField.count()) {
      await householdField.fill(`Password Household ${stamp}`);
    }
    await page.click('button[type="submit"]');
    // A new account is asked which screen it wants (Journey 8).
    await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });

    // ----------------------------------------------------------------- when --
    await page.goto("/settings");
    await page.getByLabel("Contraseña actual").fill(OLD_PASSWORD);
    await page.getByLabel("Contraseña nueva", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Repite la contraseña nueva").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Cambiar la contraseña" }).click();

    // ----------------------------------------------------------------- then --
    // This device is signed out, which the form said before it was pressed.
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

    // The old password is refused...
    await signIn(page, email, OLD_PASSWORD);
    await expect(
      page.getByRole("status").filter({ hasText: "El correo o la contraseña no son correctos" }),
      "the old password was not refused after the change",
    ).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/login/);

    // ...and the new one gets in.
    await signIn(page, email, NEW_PASSWORD);
    await expect(
      page,
      "the new password did not sign in — the change refused the old one by breaking the account",
    ).toHaveURL(/\/start/, { timeout: 30_000 });
  });
});
