import { test, expect, type Page } from "@playwright/test";
import { SESSION_FILE } from "./session";
import { settle } from "./settle";
import es from "../messages/es.json";

/**
 * Phase 4's done-when: a shop composed in aeroplane mode, applied once.
 *
 * Three tests, and each names something no cheaper tier can answer. The queue's
 * state machine, the classifier and the projection are all tested in
 * milliseconds without a browser — what is left here is whether the *whole*
 * thing works when the network genuinely goes away: a real service worker, a
 * real `localStorage`, a real reconnect, and a real server on the other end.
 *
 * chromium only, by construction rather than by configuration: firefox and
 * webkit filter on `@smoke`, Mobile Safari on `LAYOUT_SPECS`, so an untagged
 * spec outside that list runs here alone. No `playwright.config.ts` change.
 */

/** The two regions, addressed by test id: Next's route announcer is also an alert. */
const calm = (page: Page) => page.getByTestId("sync-calm");
const urgent = (page: Page) => page.getByTestId("sync-urgent");

/**
 * Wait until the queue has actually read the device.
 *
 * The calm region is empty when everything is saved *and* when the queue has
 * not been hydrated yet — same DOM, opposite meanings. Asserting the region is
 * empty without this first is asking "has everything been sent?" before anyone
 * has looked, and taking silence for yes. That is not hypothetical: it reloaded
 * a page on top of two changes that had never left the device, and the list
 * came back empty.
 *
 * Cheap on a page that has already hydrated, which is most of them.
 */
async function queueReady(page: Page): Promise<void> {
  await expect(page.getByTestId("sync-status")).toHaveAttribute(
    "data-sync",
    "ready",
    { timeout: 15_000 },
  );
}

/**
 * A list of this test's own, with its own items.
 *
 * It used to open the seeded list, and that made every test here depend on
 * what every other journey had done to it: `/shopping` hides a list whose
 * items are all ticked, and "generate from low stock" adds a newer one that
 * sorts first. It passed alone and failed in a full run, which is
 * `ISSUES.md` TEST-3 wearing a different hat.
 *
 * Creating one costs four actions and buys independence from the seed, from
 * the order specs run in, and from each other.
 */
async function openOwnList(page: Page, items: number): Promise<void> {
  const name = `Offline ${Date.now()}-${Math.round(Math.random() * 1e6)}`;

  // The manager, not the shop screen: `/shopping` is Screen A now.
  await page.goto("/shopping/lists");
  await settle(page);

  await page.getByRole("button", { name: es.shopping.create }).click();
  await page.getByLabel(es.shopping.listName).fill(name);
  await page
    .getByRole("button", { name: es.shopping.create })
    .click();

  const link = page.getByRole("link", { name: new RegExp(name) });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
  await page.waitForURL(/\/shopping\/[a-z0-9]+/);
  await settle(page);

  // An item names a product the household has, rather than free text typed
  // onto the list — so the seeded catalogue is where these come from.
  const chosen: string[] = [];
  for (let i = 0; i < items; i += 1) {
    await page.getByRole("button", { name: es.shopping.addItem }).click();

    const picker = page.locator('select[name="productId"]');
    await expect(picker.locator("option")).not.toHaveCount(1, {
      timeout: 15_000,
    });
    const value = await picker.locator("option").nth(i + 1).getAttribute("value");
    const label = await picker.locator("option").nth(i + 1).textContent();
    await picker.selectOption(value ?? "");
    // The option reads "Nombre — Marca"; the row shows the name alone.
    chosen.push((label ?? "").split("—")[0]!.trim());

    await page
      .getByRole("button", { name: es.shopping.addToList, exact: true })
      .click();
    await expect(page.getByText(chosen[i]!, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
  }

  // Wait for the queue to empty and then re-read from the server.
  //
  // Adding goes through the queue too, so an item is visible via the
  // projection before the server has it. Cutting the network at that moment
  // leaves the cached list one item behind — which is correct behaviour and
  // a useless starting point for a test about ticking things off.
  await queueReady(page);
  await expect(calm(page)).toBeEmpty({ timeout: 20_000 });
  await page.reload();
  await settle(page);
}

test.describe("A shop with no signal", () => {
  test.use({ storageState: SESSION_FILE });

  test("is composed offline, shown as done, and applied once on reconnect", async ({
    page,
    context,
  }) => {
    await openOwnList(page, 2);

    // The two to tick are found by reading the current state once and then
    // addressed by position. A locator filtered on `:not(:checked)` stops
    // matching the moment it is clicked, which makes the assertion that
    // follows it fail on correct code.
    const all = page.getByRole("checkbox");
    const checked = await all.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLInputElement).checked),
    );
    const untickedIndices = checked
      .map((isChecked, index) => (isChecked ? -1 : index))
      .filter((index) => index >= 0);
    expect(untickedIndices.length).toBeGreaterThan(1);

    const first = all.nth(untickedIndices[0] as number);
    const second = all.nth(untickedIndices[1] as number);

    await context.setOffline(true);

    // Tick two items with no connection at all. Each is recorded on the
    // device and shown as done immediately — this is the projection, and
    // without it the taps would appear to do nothing.
    await first.click();
    await expect(first).toBeChecked();
    await second.click();
    await expect(second).toBeChecked();

    // Said in words, not as a colour or a spinner.
    await expect(calm(page)).toContainText(
      /cambios sin enviar/i,
    );

    await context.setOffline(false);

    // The indicator falls silent once everything has been sent.
    await queueReady(page);
    await expect(calm(page)).toBeEmpty({ timeout: 20_000 });
    await expect(urgent(page)).toBeEmpty();

    // The server agrees, and a reload proves it rather than the projection:
    // after a reload the queue is empty, so what is on screen came back from
    // the database. Both items were ticked, so nothing is left unticked.
    await page.reload();
    await settle(page);
    await expect(
      page.getByRole("checkbox").and(page.locator(":not(:checked)")),
    ).toHaveCount(0);

  });

  test("sends the same key when the first attempt is lost", async ({
    page,
    context,
  }) => {
    await openOwnList(page, 2);

    const keys: string[] = [];
    let failedOnce = false;

    await page.route("**/api/trpc/**", async (route, request) => {
      if (request.method() !== "POST") return route.continue();

      const body = request.postData() ?? "";
      const match = /"idempotencyKey":"([^"]+)"/.exec(body);
      if (!match) return route.continue();

      keys.push(match[1] as string);

      if (!failedOnce) {
        failedOnce = true;
        // The reply is lost after the request left. This is the case the whole
        // idempotency design exists for.
        return route.fulfill({ status: 503, body: "" });
      }
      return route.continue();
    });

    await context.setOffline(true);
    await page.getByRole("checkbox").first().click();
    await context.setOffline(false);

    await queueReady(page);
    await expect(calm(page)).toBeEmpty({ timeout: 30_000 });

    expect(keys.length).toBeGreaterThanOrEqual(2);
    // A second key for the same change would be a double-apply the server
    // cannot catch, because the two would not look like the same request.
    expect(new Set(keys).size).toBe(1);

  });

  test("keeps unsent changes across a reload", async ({ page }) => {
    await openOwnList(page, 2);

    // The server is made unreachable at the application level rather than the
    // browser level, so the *page* still loads on reload. Cutting the browser
    // off entirely would test the service worker instead, and the worker does
    // not register under `next dev` by design — see STATUS.md.
    let blocked = true;
    await page.route("**/api/trpc/**", async (route, request) => {
      if (blocked && request.method() === "POST") {
        return route.abort("internetdisconnected");
      }
      return route.continue();
    });

    const all = page.getByRole("checkbox");
    const checked = await all.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLInputElement).checked),
    );
    const firstUnticked = checked.findIndex((isChecked) => !isChecked);
    await all.nth(firstUnticked).click();
    await expect(calm(page)).toContainText(/sin enviar/i);

    // iOS discards tabs. If the queue did not survive this, the person would
    // reopen to untouched rows and tick everything a second time — with new
    // keys, which no idempotency can catch.
    await page.reload();
    await settle(page);

    await expect(calm(page)).toContainText(/sin enviar/i, {
      timeout: 20_000,
    });

    blocked = false;
    await queueReady(page);
    await expect(calm(page)).toBeEmpty({ timeout: 30_000 });

  });
});

test.describe("Screen A, with no signal", () => {
  test.use({ storageState: SESSION_FILE });

  test("ticks something off from the shop screen and applies it once", async ({
    page,
    context,
  }) => {
    // Composed through the manager, shopped on Screen A — which is how it
    // works in life: somebody fills the list at home and takes the phone out.
    await openOwnList(page, 2);
    await page.goto("/shopping");
    await settle(page);

    const rows = page.getByRole("button", { name: /Marcar/ });
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();
    expect(before).toBeGreaterThan(1);

    await context.setOffline(true);

    await rows.first().click();
    // Straight into the trolley, before any server has heard about it.
    await expect(page.getByRole("button", { name: /Marcar/ })).toHaveCount(
      before - 1,
    );
    await expect(page.getByTestId("sync-calm")).toContainText(/sin enviar/i);

    await context.setOffline(false);
    await expect(page.getByTestId("sync-calm")).toBeEmpty({ timeout: 20_000 });

    // A reload empties the queue, so what is on screen came from the server.
    await page.reload();
    await settle(page);
    await expect(page.getByRole("button", { name: /Marcar/ })).toHaveCount(
      before - 1,
    );
  });
});

test.describe("An offline scan, resolved later (T7)", () => {
  test.use({ storageState: SESSION_FILE });

  test("an unknown barcode is queued, asks to be named, and the form is prefilled", async ({
    page,
    context,
  }) => {
    // A barcode with no product anywhere. resolveScan calls Open Food Facts on
    // drain; whether OFF is unreachable or simply does not know this code, the
    // service returns null and the scan lands as needs-review — deterministic
    // either way. Going offline while *on* the scan page keeps the service
    // worker out of it (a navigation offline is the worker's test, not this).
    const unknown = "9990000000017";

    await page.goto("/products/scan");
    await queueReady(page);

    await context.setOffline(true);
    await page.getByPlaceholder(es.products.scan.manualPlaceholder).fill(unknown);
    await page.getByRole("button", { name: es.products.scan.manualSubmit }).click();

    // Queued, said in words, still on the scan page — not a dead end.
    await expect(calm(page)).toContainText(/sin (enviar|conexión)/i, {
      timeout: 15_000,
    });

    await context.setOffline(false);

    // On reconnect the scan drains, OFF cannot name it, and the indicator
    // turns the refusal into a question rather than a failure.
    const nameIt = urgent(page).getByRole("link", {
      name: es.offline.nameIt,
    });
    await expect(nameIt).toBeVisible({ timeout: 30_000 });

    await nameIt.click();
    await page.waitForURL(/\/products\/new\?/);
    await settle(page);

    // The barcode carried into the form.
    await expect(page.getByLabel(es.products.new.barcodeLabel)).toHaveValue(
      unknown,
    );

    await page.getByLabel(es.products.new.nameLabel).fill("Producto del ticket");
    await page
      .getByRole("button", { name: es.products.new.submit })
      .click();

    // Wait for the create to actually succeed before leaving — its onSuccess
    // is what discards the queued scan, and navigating away mid-flight would
    // abort it.
    await expect(
      page.getByText(
        es.products.new.successCreated.replace("{name}", "Producto del ticket"),
      ),
    ).toBeVisible({ timeout: 20_000 });

    // The review question clears because the queued scan is discarded on a
    // successful create.
    await page.goto("/products/scan");
    await queueReady(page);
    await expect(urgent(page)).toBeEmpty({ timeout: 20_000 });

    // The product exists in the catalogue.
    await page.goto("/products");
    await settle(page);
    await expect(
      page.getByText("Producto del ticket", { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("a barcode the household already has resolves silently", async ({
    page,
    context,
  }) => {
    // A seeded barcode is already a product, so resolveScan short-circuits to
    // the local row on drain: nothing is created, the queue empties, and no
    // review question is ever raised.
    const known = "8410000678901";

    await page.goto("/products/scan");
    await queueReady(page);

    const before = await page.evaluate(async () => {
      const res = await fetch("/api/health");
      return res.ok;
    });
    expect(before).toBe(true);

    await context.setOffline(true);
    await page.getByPlaceholder(es.products.scan.manualPlaceholder).fill(known);
    await page.getByRole("button", { name: es.products.scan.manualSubmit }).click();
    await expect(calm(page)).toContainText(/sin (enviar|conexión)/i, {
      timeout: 15_000,
    });

    await context.setOffline(false);

    // Drains to nothing — no review, no failure.
    await queueReady(page);
    await expect(calm(page)).toBeEmpty({ timeout: 30_000 });
    await expect(urgent(page)).toBeEmpty();
  });
});

test.describe("The offline page", () => {
  test("is readable with no JavaScript at all", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto("/offline");

    // Precaching an HTML document does not precache the chunks it references,
    // so anything needing hydration is blank exactly when this page is needed.
    await expect(
      page.getByRole("heading", { name: es.offlinePage.heading }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: es.offlinePage.back }),
    ).toBeVisible();

    await context.close();
  });
});
