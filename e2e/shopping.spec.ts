import { test, expect, type Page } from "@playwright/test";
import { SESSION_FILE } from "./session";
import { settle } from "./settle";
import es from "../messages/es.json";

test.use({ storageState: SESSION_FILE });

/**
 * The calm region is empty both when everything is sent and before the queue
 * has read the device, so it only means "sent" once the queue says it is ready.
 */
async function allSent(page: Page): Promise<void> {
  await expect(page.getByTestId("sync-status")).toHaveAttribute(
    "data-sync",
    "ready",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("sync-calm")).toBeEmpty({ timeout: 20_000 });
}

test("a list is made, ticked off in the shop with no signal, and saved on reconnect", async ({
  page,
  context,
}) => {
  const listName = `Compra E2E ${Date.now()}-${test.info().parallelIndex}`;

  await page.goto("/shopping/lists");
  await settle(page);
  await page.getByRole("button", { name: es.shopping.create }).click();
  await page.getByLabel(es.shopping.listName).fill(listName);
  await page.getByRole("button", { name: es.shopping.create }).click();
  await page
    .getByRole("link", { name: new RegExp(listName) })
    .click({ timeout: 15_000 });
  await page.waitForURL(/\/shopping\/[a-z0-9]+/);
  await settle(page);

  await page.getByRole("button", { name: es.shopping.addItem }).click();
  const picker = page.locator('select[name="productId"]');
  await expect(picker.locator("option")).not.toHaveCount(1, {
    timeout: 15_000,
  });
  await picker.selectOption({ index: 1 });
  await page
    .getByRole("button", { name: es.shopping.addToList, exact: true })
    .click();

  // Start offline from what the server holds, not from the device's projection.
  await allSent(page);
  await page.reload();
  await settle(page);

  const item = page.getByRole("checkbox");
  await expect(item).toHaveCount(1);
  await context.setOffline(true);
  await item.click();
  await expect(item).toBeChecked();
  await expect(page.getByTestId("sync-calm")).toContainText(/sin enviar/i);

  await context.setOffline(false);
  await allSent(page);
  await page.reload();
  await settle(page);
  await expect(page.getByRole("checkbox")).toBeChecked();
});
