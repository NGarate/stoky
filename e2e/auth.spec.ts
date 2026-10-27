import { test, expect } from "@playwright/test";
import { register, signIn, signOut } from "./account";
import es from "../messages/es.json";

test("registers, picks a start screen, signs out and signs back in", async ({
  page,
}) => {
  const email = await register(page, "auth");

  await page
    .getByRole("button", { name: new RegExp(es.start.kitchen) })
    .click();
  await expect(page).toHaveURL(/\/kitchen/);

  await signOut(page);
  await signIn(page, email);

  // The choice belongs to this device, so signing in again is not asked twice.
  await expect(page).toHaveURL(/\/kitchen/, { timeout: 30_000 });
});
