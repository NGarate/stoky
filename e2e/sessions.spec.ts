import { test, expect } from "@playwright/test";
import { PASSWORD, register, signIn, signedIn } from "./account";
import es from "../messages/es.json";

const t = es.security;

test("ends another device's session from the devices list", async ({
  page,
  browser,
}) => {
  const email = await register(page, "sessions");
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other, email);
  await expect(other).toHaveURL(/\/start/, { timeout: 30_000 });

  await page.goto("/settings/security");
  const otherRow = page
    .getByRole("region", { name: t.devicesTitle })
    .getByRole("listitem")
    .filter({ hasNot: page.getByText(t.thisDevice, { exact: true }) });
  await otherRow
    .getByRole("button", { name: new RegExp(`^${t.endOne}`) })
    .click({ timeout: 30_000 });
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(es.reauth.password).fill(PASSWORD);
  await dialog.getByRole("button", { name: t.endOne, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  expect(await signedIn(other)).toBe(false);
  expect(await signedIn(page)).toBe(true);
  await otherContext.close();
});
