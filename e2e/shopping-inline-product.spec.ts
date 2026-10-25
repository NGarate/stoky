import { test, expect } from "@playwright/test";
import { SESSION_FILE } from "./session";
import { settle } from "./settle";
import es from "../messages/es.json";

/**
 * Writing something the household has never bought, from the shopping list.
 *
 * This is the kindness that replaced free text (D103). Free text was dropped
 * because an item that names nothing cannot be priced, counted or matched;
 * the promise made in exchange was that creating the product inline would
 * still take one step. That promise was not kept: the form did nothing and
 * threw away what had been typed.
 *
 * **Why this is a browser test and not a component one.** The cause was
 * nested `<form>` elements — `CreateProductInline` is a form, and it was
 * rendered inside the add-item form. React builds the DOM through
 * `createElement` rather than the HTML parser, so both elements really exist
 * and happy-dom is perfectly happy: a component test passes either way.
 *
 * What a real browser does with them was measured, not assumed. Both forms
 * were present, the submit button's form owner was correctly the inner one,
 * and the click still produced a native submission and a document load with
 * no `product.create` request anywhere in the network log. The name typed
 * into the box went with it.
 *
 * The lesson generalises past this file: a component that renders a `<form>`
 * cannot be dropped inside another one, and only a browser will say so.
 *
 * chromium only, like the other untagged specs here.
 */
test.describe("Creating a product from the shopping list", () => {
  test.use({ storageState: SESSION_FILE });

  test("puts the new product on the list in one step", async ({ page }) => {
    const listName = `Inline ${Date.now()}`;
    const productName = `Sellos ${Date.now()}`;

    await page.goto("/shopping/lists");
    await settle(page);

    await page.getByRole("button", { name: es.shopping.create }).click();
    await page.getByLabel(es.shopping.listName).fill(listName);
    await page.getByRole("button", { name: es.shopping.create }).click();

    const link = page.getByRole("link", { name: new RegExp(listName) });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.click();
    await page.waitForURL(/\/shopping\/[a-z0-9]+/);
    await settle(page);

    await page.getByRole("button", { name: es.shopping.addItem }).click();
    await page
      .getByRole("button", { name: es.shopping.createProductPrompt })
      .click();

    const nameBox = page.getByPlaceholder(es.receipts.productNamePlaceholder);
    await expect(nameBox).toBeVisible({ timeout: 15_000 });
    await nameBox.fill(productName);

    await page.getByRole("button", { name: es.receipts.createProduct }).click();

    // The item, on the list. Not a validation error, and not an empty form.
    await expect(
      page.getByText(productName, { exact: false }).first(),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(es.shopping.productRequired)).toHaveCount(0);
  });
});
