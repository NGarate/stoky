import { test, expect, type Page } from "@playwright/test";

/**
 * The service worker, actually running — the gap `REDESIGN_PLAN.md` §10 names.
 *
 * `registerServiceWorker` returns early unless `NODE_ENV` is `production`, and
 * the browser suite runs against `pnpm dev`. So the whole of Phase 4's
 * foundation — install, activate, precache, the fetch handler, the offline
 * fallback — had never been executed by any test. Its *source* is checked in
 * the component tier: that `classify` refuses what it should, that the file is
 * not gitignored, that `register.ts` guards an insecure origin. That the thing
 * works was, until now, an assumption.
 *
 * **A separate config on purpose.** This needs a real `next build`, served by
 * the standalone server the Docker image runs — a minute before the first test,
 * which the ordinary suite's five-minute budget cannot absorb, and a budget
 * that is not enforced is not a budget. `pnpm test:e2e:sw` runs it.
 *
 * **Chromium only**, because these are Chrome DevTools Protocol operations —
 * `setOffline` on the context is Playwright's, but the worker lifecycle
 * assertions below need `page.evaluate` against a real `navigator.serviceWorker`
 * and only one engine here exposes it consistently.
 */

/** Wait until a worker has installed, activated and taken this page over. */
async function waitForController(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean(navigator.serviceWorker?.controller),
    undefined,
    { timeout: 30_000 },
  );
}

test.describe.configure({ mode: "serial" });

test.describe("a production build's service worker", () => {
  test("registers itself and takes control of the page", async ({ page }) => {
    await page.goto("/login");

    // The first load registers; control arrives after `skipWaiting` and
    // `clients.claim`, which is why this waits rather than asserting once.
    await waitForController(page);

    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.scope ?? null;
    });

    expect(scope).toContain("/");
  });

  test("precaches the offline page during install", async ({ page }) => {
    await page.goto("/login");
    await waitForController(page);

    // `install` adds exactly one document — `/offline` — because it is the one
    // that has to be there when nothing else is. Everything else is cached on
    // the way past.
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      for (const name of names.filter((n) => n.startsWith("stoky-shell-"))) {
        const cache = await caches.open(name);
        if (await cache.match("/offline")) return true;
      }
      return false;
    });

    expect(cached).toBe(true);
  });

  test("keeps the built chunks it was served, not the ones dev would have made", async ({
    page,
  }) => {
    // The reason this spec is worth a production build at all. In development
    // the chunks are unhashed and regenerated per request; a worker caching
    // those proves nothing about the deployment. Here they are the real,
    // immutable `/_next/static/**` files.
    await page.goto("/login");
    await waitForController(page);
    await page.reload();

    const staticEntries = await page.evaluate(async () => {
      const names = await caches.keys();
      for (const name of names.filter((n) => n.startsWith("stoky-static-"))) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        return keys.filter((request) => request.url.includes("/_next/static/"))
          .length;
      }
      return 0;
    });

    expect(staticEntries).toBeGreaterThan(0);
  });

  test("serves a page with the network cut off", async ({ page, context }) => {
    // The whole point of the thing. Without a worker this is the browser's own
    // "no internet" page, which is where a shop in a basement ends.
    await page.goto("/login");
    await waitForController(page);
    await page.reload();

    await context.setOffline(true);

    try {
      await page.goto("/login", { waitUntil: "domcontentloaded" });

      // Asserted against *our* markup, not against "the body has text".
      // Chromium's own "no internet" page has plenty of text, so a length
      // check would pass with no worker at all — which is the failure this
      // test exists to catch.
      await expect(page.locator("form")).toBeVisible();
      await expect(page.getByRole("button", { name: /iniciar sesión|sign in/i })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test("falls back to the offline page for a route it never cached", async ({
    page,
    context,
  }) => {
    // The allowlist governs what is *kept*, not what is served: an unlisted
    // route still gets the offline page rather than the browser's error.
    await page.goto("/login");
    await waitForController(page);

    await context.setOffline(true);

    try {
      await page.goto("/prices/never-visited", { waitUntil: "domcontentloaded" });

      // The precached `/offline` document, by its own words. Chromium's error
      // page says "no internet" too, in the browser's language and not ours —
      // so this asserts the sentence the application wrote, which is also the
      // one that tells the person their unsent changes are safe.
      await expect(
        page.getByText(/no hay conexión|no connection/i),
      ).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
