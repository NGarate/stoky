import { test, expect, type Page } from "@playwright/test";
import { SESSION_FILE } from "./session";
import { settle } from "./settle";
import es from "../messages/es.json";

test.use({ storageState: SESSION_FILE });

// A seeded product, so this test brings no setup of its own.
const PRODUCT = "Arroz redondo";

async function book(
  page: Page,
  path: string,
  quantity: string,
  submit: string,
) {
  await page.goto(path);
  await settle(page);
  const select = page.locator('select[name="productId"]');
  const option = select.locator("option", { hasText: PRODUCT });
  await expect(option).toHaveCount(1, { timeout: 30_000 });
  await select.selectOption((await option.getAttribute("value")) ?? "");
  await page.fill('input[name="quantity"]', quantity);
  await page.getByRole("button", { name: submit, exact: true }).click();
}

test("adds stock to a product and then uses some of it", async ({ page }) => {
  await book(page, "/inventory/add", "2", es.inventory.add.submit);
  await expect(page.getByRole("dialog")).toContainText(
    es.inventory.add.successTitle,
    { timeout: 30_000 },
  );

  await book(page, "/inventory/consume", "1", es.inventory.consume.submit);
  await expect(page.getByRole("dialog")).toContainText(
    es.inventory.consume.successTitle,
    { timeout: 30_000 },
  );
});
