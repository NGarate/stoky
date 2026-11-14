import { test, expect } from "@playwright/test";
import { freshAccount, signIn, signOut } from "./account";
import es from "../messages/es.json";

test("signs in, picks a start screen, signs out and signs back in", async ({
  page,
}) => {
  const email = await freshAccount(page, "auth");

  await page
    .getByRole("button", { name: new RegExp(es.start.kitchen) })
    .click();
  await expect(page).toHaveURL(/\/kitchen/);

  await signOut(page);
  await signIn(page, email);

  // The choice belongs to this device, so signing in again is not asked twice.
  await expect(page).toHaveURL(/\/kitchen/, { timeout: 30_000 });
});
