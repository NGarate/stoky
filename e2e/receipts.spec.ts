import { test, expect } from "@playwright/test";
import { SESSION_FILE } from "./session";
import { settle } from "./settle";
import es from "../messages/es.json";

test.use({ storageState: SESSION_FILE });

// The seed's newest receipt is reviewed and waiting to be applied
// (`prisma/seed.ts`), which is the step that writes the inventory.
test("adds a reviewed receipt to the inventory", async ({ page }) => {
  await page.goto("/receipts");
  await settle(page);
  await page.locator('a[href$="/review"]').first().click();
  await page.waitForURL(/\/receipts\/[^/]+\/review$/);

  await page
    .getByRole("button", { name: es.receipts.applyToInventory })
    .click();

  await expect(page).toHaveURL(/\/receipts\/[^/]+\/applied$/, {
    timeout: 30_000,
  });
  await expect(
    page.getByRole("heading", { level: 1, name: es.receipts.applied.title }),
  ).toBeVisible();
});

// The seed's Mercadona receipt still has undecided lines, so correcting it
// cannot race the test above, which applies the confirmed one.
test("corrects what OCR misread and adds what it missed", async ({ page }) => {
  await page.goto("/receipts");
  await settle(page);
  await page
    .locator('a[href$="/review"]', { hasText: "Mercadona" })
    .first()
    .click();
  await page.waitForURL(/\/receipts\/[^/]+\/review$/);
  await settle(page);

  // A misread line total.
  await page
    .getByRole("button", { name: "Corregir la línea «Servilletas 100u»" })
    .click();
  await page
    .getByLabel(es.receipts.line.priceLabel, { exact: true })
    .fill("1.35");
  await page.getByRole("button", { name: es.receipts.line.save }).click();
  await expect(page.getByText(/1,35/)).toBeVisible();

  // A line OCR skipped.
  await page.getByRole("button", { name: es.receipts.line.add }).click();
  await page
    .getByLabel(es.receipts.line.nameLabel, { exact: true })
    .fill("Pan de barra");
  await page
    .getByLabel(es.receipts.line.priceLabel, { exact: true })
    .fill("0.6");
  await page.getByRole("button", { name: es.receipts.line.add }).click();
  await expect(page.getByText("Pan de barra")).toBeVisible();

  // And the total that now covers it.
  await page.getByRole("button", { name: es.receipts.details.edit }).click();
  await page.getByLabel(es.receipts.totalAmount, { exact: true }).fill("8.09");
  await page.getByRole("button", { name: es.receipts.details.save }).click();
  await expect(page.getByText(/8,09/)).toBeVisible();
});
