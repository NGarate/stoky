import { test, expect } from "@playwright/test";
import { PASSWORD, register, signIn } from "./account";
import { settle } from "./settle";
import es from "../messages/es.json";

const NEW_PASSWORD = "tarro de garbanzos azul";
const t = es.password;

test("changes the password, and the new one signs in", async ({ page }) => {
  const email = await register(page, "password");

  await page.goto("/settings/security");
  await settle(page);
  await page.getByLabel(t.current).fill(PASSWORD);
  await page.getByLabel(t.new, { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel(t.confirm).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: t.submit }).click();
  await expect(
    page.getByRole("status").filter({ hasText: t.changedTitle }),
  ).toBeVisible({ timeout: 30_000 });

  await page.context().clearCookies();
  await signIn(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/start/, { timeout: 30_000 });
});
