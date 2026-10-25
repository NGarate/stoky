import { test, expect, type Page } from "@playwright/test";
import { SESSION_FILE } from "./session";

/**
 * The service worker, actually running — the gap `REDESIGN_PLAN.md` §10 names.
 *
 * `registerServiceWorker` returns early unless `NODE_ENV` is `production`, and
 * the browser suite runs against `bun run dev`. So the whole of Phase 4's
 * foundation — install, activate, precache, the fetch handler, the offline
 * fallback — had never been executed by any test. Its *source* is checked in
 * the component tier: that `classify` refuses what it should, that the file is
 * not gitignored, that `register.ts` guards an insecure origin. That the thing
 * works was, until now, an assumption.
 *
 * **It needs a real `next build`**, served by the standalone server the Docker
 * image runs. That once justified a config of its own — a minute before the
 * first test, which the ordinary suite's budget could not absorb. That config
 * was deleted on 2026-08-17 when the whole suite moved to serving the
 * standalone build, so the cost is paid once for everything and this file is
 * simply part of `bunx playwright test`. It is listed in `CHROMIUM_ONLY`, which
 * the other projects take as `testIgnore`: a question about the deployed
 * artefact has one engine's answer, not five.
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

// 90s where the main config's default is 60: an install-and-activate cycle
// plus an offline navigation is genuinely slower than a page assertion — the
// old prod config said so explicitly, and folding in must not tighten it
// silently.
test.describe.configure({ mode: "serial", timeout: 90_000 });

// The main config blocks service workers — a live worker's navigation
// fallback makes ordinary tests dishonest under load (see `use` in
// playwright.config.ts). This suite's *subject* is the worker, so it is the
// one place that opts back in.
test.use({ serviceWorkers: "allow" });

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

  test.describe("signed in", () => {
    test.use({ storageState: SESSION_FILE });

    test("serves a page with the network cut off", async ({
      page,
      context,
    }) => {
      // The whole point of the thing. Without a worker this is the browser's
      // own "no internet" page, which is where a shop in a basement ends.
      //
      // A shell route, signed in, because that is what the worker keeps. This
      // used to use `/login`, which is not a shell route and only passed
      // because every unlisted page was being kept, by mistake, in a cache
      // sign-out never purged.
      await page.goto("/inventory");
      await waitForController(page);
      // Under the worker's control this time, so it is the worker that keeps it.
      await page.reload();

      await context.setOffline(true);

      try {
        await page.goto("/inventory", { waitUntil: "domcontentloaded" });

        // Asserted against *our* markup, not against "the body has text".
        // Chromium's own "no internet" page has plenty of text, so a length
        // check would pass with no worker at all — which is the failure this
        // test exists to catch.
        await expect(
          page.getByRole("navigation", { name: "Navegación principal" }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "Inventario" }).first(),
        ).toBeVisible();
      } finally {
        await context.setOffline(false);
      }
    });
  });

  test("links a manifest Chromium parses cleanly, with icons that load", async ({
    page,
  }) => {
    // The unit tier checks the manifest's fields; this asks the browser. For
    // months the worker above passed every test here while the application
    // had no manifest at all, so no browser could install it.
    //
    // **Not `Page.getInstallabilityErrors`**, though it is the obvious call.
    // Measured 2026-10-10 against this suite's Chromium: it answered `[]` for
    // a manifest with no icons and for `display: "browser"`, so asserting on it
    // proves nothing. `getAppManifest`'s `errors` does discriminate — an
    // unknown `display` came back as "unknown 'display' value ignored." — and
    // the icons are fetched the way the installer would fetch them.
    await page.goto("/login");
    const cdp = await page.context().newCDPSession(page);

    const { errors, url, data } = await cdp.send("Page.getAppManifest");
    expect(url).toMatch(/\/manifest\.webmanifest$/);
    expect(errors).toEqual([]);

    const manifest = JSON.parse(data ?? "{}") as {
      icons?: Array<{ src: string; type?: string }>;
    };
    expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);
    for (const icon of manifest.icons ?? []) {
      const response = await page.request.get(icon.src);
      expect(response.status(), icon.src).toBe(200);
      expect(response.headers()["content-type"], icon.src).toBe(icon.type);
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
      await page.goto("/prices/never-visited", {
        waitUntil: "domcontentloaded",
      });

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
