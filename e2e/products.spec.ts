import { test, expect } from "@playwright/test";
import { SESSION_FILE } from "./session";
import { settle } from "./settle";
import es from "../messages/es.json";

test.use({ storageState: SESSION_FILE });

test("creates a product and finds it in the catalogue", async ({ page }) => {
  const name = `Producto E2E ${Date.now()}-${test.info().parallelIndex}`;

  await page.goto("/products/new");
  await settle(page);
  await page.fill('input[name="name"]', name);
  await page.getByRole("button", { name: es.products.new.submit }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(name, { timeout: 30_000 });
  await dialog
    .getByRole("link", { name: es.products.new.successViewProducts })
    .click();

  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});
