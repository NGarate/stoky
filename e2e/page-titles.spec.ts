import { expect, test } from "@playwright/test";
import es from "../messages/es.json";
import { SESSION_FILE } from "./session";

/**
 * WCAG 2.4.2 (Level A): every page says what it is, in the reader's language,
 * and moving between pages is announced.
 *
 * Until this existed every route wore one hardcoded English title, and the
 * second half of that was the worse one. Next's route announcer speaks on a
 * client navigation only when `document.title` changes
 * (`next/dist/client/components/app-router-announcer.js`), so with one title
 * for everything a screen-reader user who followed a link was told nothing.
 *
 * The expected titles are written out here rather than read from
 * `src/lib/route-titles.ts`: a test that asks the table what the table says
 * cannot notice that the table is wrong. `route-titles.test.ts` is the half
 * that proves no route is missing from it.
 */

const title = (page: string) => `${page} · Stoky`;

test.describe("page titles, signed in", () => {
  test.use({ storageState: SESSION_FILE });
  test.describe.configure({ mode: "parallel" });

  // Dynamic routes take an id that does not exist: the title belongs to the
  // route, so it must hold on the page's error state as much as on its data.
  const ROUTES: Array<[string, string]> = [
    ["/dashboard", es.dashboard.title],
    ["/kitchen", es.kitchen.title],
    ["/inventory", es.inventory.title],
    ["/inventory/add", es.inventory.add.title],
    ["/inventory/consume", es.inventory.consume.title],
    ["/products", es.products.list.title],
    ["/products/new", es.products.new.title],
    ["/products/scan", es.products.scan.title],
    ["/products/no-such-product", es.products.detail.loadingTitle],
    ["/products/no-such-product/history", es.products.history.title],
    ["/prices", es.prices.title],
    ["/receipts", es.receipts.title],
    ["/receipts/upload", es.receipts.upload],
    ["/shopping", es.shopping.shopTitle],
    ["/shopping/lists", es.shopping.title],
    ["/shopping/no-such-list", es.shopping.listPageTitle],
    ["/settings", es.settings.hub.title],
    ["/settings/screen", es.start.settingsTitle],
    ["/settings/unsaved", es.offline.unsavedTitle],
  ];

  for (const [path, name] of ROUTES) {
    test(`${path} is titled “${name}”`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(title(name));
    });
  }

  test("a client navigation changes the title, and the announcer says so", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveTitle(title(es.dashboard.title));

    // A link in the visible navigation — a client navigation, not a reload,
    // which is the case the announcer exists for and the one that was silent.
    await page.locator('a[href="/inventory"]:visible').first().click();
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page).toHaveTitle(title(es.inventory.title));

    // The announcer lives in an open shadow root, which CSS locators pierce.
    await expect(page.locator("#__next-route-announcer__")).toHaveText(
      title(es.inventory.title),
    );
  });
});

test("the sign-in page is titled in Spanish before anyone signs in", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page).toHaveTitle(title(es.auth.login));
});
