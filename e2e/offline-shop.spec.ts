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

test.describe("A shop with no signal", () => {
  test.use({ storageState: SESSION_FILE });

  /**
   * Serial, and each test leaves the seed as it found it.
   *
   * `/shopping` hides a list whose items are all ticked — `shopping.list`
   * filters on `items: { some: { isChecked: false } }` — so a test that
   * completes the seeded list makes the next one unable to find it. That is
   * `ISSUES.md` TEST-3 exactly: one journey writing the state another asserts.
   */
  test.describe.configure({ mode: "serial" });

  /** The two regions, addressed by test id: Next's route announcer is also an alert. */
  const calm = (page: Page) => page.getByTestId("sync-calm");
  const urgent = (page: Page) => page.getByTestId("sync-urgent");

  /** The seeded list is a cuid, so it is discovered rather than hardcoded. */
  async function openSeededList(page: Page): Promise<string> {
    await page.goto("/shopping");
    await settle(page);

    // By href rather than by name: the card is the link, its accessible name
    // is the whole card's text, and the auto-generated list may or may not
    // exist depending on what earlier journeys did.
    const firstList = page.locator('a[href^="/shopping/"]').first();
    await expect(firstList).toBeVisible();
    await firstList.click();
    await page.waitForURL(/\/shopping\/[a-z0-9]+/);
    await settle(page);

    return page.url().split("/").pop() as string;
  }

  test("is composed offline, shown as done, and applied once on reconnect", async ({
    page,
    context,
  }) => {
    await openSeededList(page);

    // The seed leaves one item already ticked, so the two to tick are found by
    // reading the current state once and then addressed by position. A locator
    // filtered on `:not(:checked)` stops matching the moment it is clicked,
    // which makes the assertion that follows it fail on correct code.
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
    await expect(calm(page)).toBeEmpty({ timeout: 20_000 });
    await expect(urgent(page)).toBeEmpty();

    // The server agrees, and a reload proves it rather than the projection:
    // after a reload the queue is empty, so what is on screen came back from
    // the database.
    await page.reload();
    await settle(page);
    await expect(
      page.getByRole("checkbox").and(page.locator(":not(:checked)")),
    ).toHaveCount(0);

    // Put the list back the way it was found, so the next test can still see
    // it on /shopping.
    await first.click();
    await expect(calm(page)).toBeEmpty({ timeout: 20_000 });
  });

  test("sends the same key when the first attempt is lost", async ({
    page,
    context,
  }) => {
    await openSeededList(page);

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

    await expect(calm(page)).toBeEmpty({ timeout: 30_000 });

    expect(keys.length).toBeGreaterThanOrEqual(2);
    // A second key for the same change would be a double-apply the server
    // cannot catch, because the two would not look like the same request.
    expect(new Set(keys).size).toBe(1);

    await page.unroute("**/api/trpc/**");
    // Restore.
    await page.reload();
    await settle(page);
    const restore = page.getByRole("checkbox");
    const nowChecked = await restore.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLInputElement).checked),
    );
    await restore.nth(nowChecked.findIndex(Boolean)).click();
    await expect(calm(page)).toBeEmpty({ timeout: 20_000 });
  });

  test("keeps unsent changes across a reload", async ({ page }) => {
    await openSeededList(page);

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
    await expect(calm(page)).toBeEmpty({ timeout: 30_000 });

    // Restore.
    await page.reload();
    await settle(page);
    const restore = page.getByRole("checkbox");
    const nowChecked = await restore.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLInputElement).checked),
    );
    await restore.nth(nowChecked.findIndex(Boolean)).click();
    await expect(calm(page)).toBeEmpty({ timeout: 20_000 });
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
