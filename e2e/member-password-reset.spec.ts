import { test, expect, type Page } from "@playwright/test";

/**
 * An admin setting a member's password, through the browser, against the
 * real server.
 *
 * `integration/household.members.test.ts` proves the procedure's guards and
 * that the old password stops working; `components/PeopleRoles.test.tsx`
 * proves the dialog with the server call passed in. Neither proves what the
 * person who forgot their password depends on: that the button on
 * `/settings/people` opens the dialog, that the dialog's submit — a button in
 * the footer, outside the form, which is this form's only through its `form`
 * attribute — reaches `household.resetMemberPassword` in a real browser, and
 * that **the member's old password is then refused while the new one signs
 * in**. The refusal alone would pass with a reset that broke the account; the
 * acceptance alone with a reset that wrote nothing.
 *
 * **Its own owner, registered here**, and its own member, created through the
 * page: every other signed-in suite shares the demo account's sessions.
 *
 * Chromium only, via `CHROMIUM_ONLY` in `playwright.config.ts`, for
 * `password-change.spec.ts`'s reason.
 */

const OWNER_PASSWORD = "E2EOwnerPassword123!";
const OLD_PASSWORD = "E2EMemberOld123!";
const NEW_PASSWORD = "tarro de garbanzos azul";

/** Unique per worker and per run, so two runs cannot collide on the address. */
function freshEmail(label: string): string {
  const worker = test.info().parallelIndex;
  return `${label}.w${worker}.${Date.now()}.${Math.random()
    .toString(36)
    .substring(7)}@example.com`;
}

async function signIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]');
  // Hydration: a pre-hydration submit falls back to a native POST, the same
  // reason `session.setup.ts` waits here.
  await page.waitForTimeout(1500);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
}

test.describe("setting a member's password", () => {
  test("the old password is refused and the new one signs in", async ({
    page,
  }) => {
    const ownerEmail = freshEmail("reset-owner");
    const memberEmail = freshEmail("reset-member");
    const stamp = Date.now();
    const memberName = `Reset E2E ${stamp}`;

    // ---------------------------------------------------------------- given --
    await page.goto("/register");
    await page.waitForSelector('input[name="email"]');
    await page.waitForTimeout(1500);
    await page.fill('input[name="name"]', `Owner E2E ${stamp}`);
    await page.fill('input[name="email"]', ownerEmail);
    await page.fill('input[name="password"]', OWNER_PASSWORD);
    const householdField = page.locator('input[name="householdName"]');
    if (await householdField.count()) {
      await householdField.fill(`Reset Household ${stamp}`);
    }
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });

    await page.goto("/settings/people");
    await page.getByLabel("Nombre", { exact: true }).fill(memberName);
    await page
      .getByLabel("Correo electrónico", { exact: true })
      .fill(memberEmail);
    await page.getByLabel("Contraseña", { exact: true }).fill(OLD_PASSWORD);
    await page.getByRole("button", { name: "Crear la cuenta" }).click();
    // The member's row, not the snackbar that also names them: a snackbar is a
    // list item too, and it has no actions.
    const row = page
      .getByRole("listitem")
      .filter({ hasText: memberName })
      .filter({
        has: page.getByRole("button", { name: "Cambiar su contraseña" }),
      });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // ----------------------------------------------------------------- when --
    await row.getByRole("button", { name: "Cambiar su contraseña" }).click();
    const dialog = page.getByRole("dialog", {
      name: `Nueva contraseña para ${memberName}`,
    });
    await dialog.getByLabel("Contraseña nueva").fill(NEW_PASSWORD);
    await dialog.getByRole("button", { name: "Cambiar la contraseña" }).click();

    // ----------------------------------------------------------------- then --
    // The admin is told what to do next, and the dialog has gone.
    await expect(
      page
        .getByTestId("snackbar")
        .filter({ hasText: `Contraseña de ${memberName} cambiada` }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toHaveCount(0);

    // The member's old password is refused...
    await page.context().clearCookies();
    await signIn(page, memberEmail, OLD_PASSWORD);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "El correo o la contraseña no son correctos" }),
      "the member's old password was not refused after the reset",
    ).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/login/);

    // ...and the new one gets in. The add form's default role is Cocina, and a
    // kitchen account is sent straight to its screen.
    await signIn(page, memberEmail, NEW_PASSWORD);
    await expect(
      page,
      "the new password did not sign in — the reset refused the old one by breaking the account",
    ).toHaveURL(/\/kitchen/, { timeout: 30_000 });
  });
});
