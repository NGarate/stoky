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
