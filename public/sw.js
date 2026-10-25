/**
 * The service worker.
 *
 * Hand-written, no plugin, no build step, no dependency. That follows from one
 * fact: `/_next/static/**` filenames are content-hashed, so a runtime
 * cache-first static cache needs no precache manifest — and emitting a
 * precache manifest is the only thing `next-pwa` and Serwist exist to do.
 * `output: "standalone"` is irrelevant here; the Dockerfile already copies
 * `public/` verbatim.
 *
 * `REDESIGN_PLAN.md` §5.4: the worker ships without ever prompting anyone to
 * "install the app". The app *is* installable through the browser's own
 * action (`src/app/manifest.ts`); an install prompt and push are deferred on
 * iOS grounds. The worker and the offline cache are not, and iOS Safari
 * supports both.
 *
 * Every global is `self.`-prefixed, **including `self.fetch`**. Without that
 * the test harness resolves a bare `fetch` to Bun's real global and the tests
 * go to the network.
 */

const VERSION = "v1";
const SHELL_CACHE = `stoky-shell-${VERSION}`;
const STATIC_CACHE = `stoky-static-${VERSION}`;
const OFFLINE_URL = "/offline";

/**
 * A cache an earlier worker wrote by mistake.
 *
 * Unlisted navigations were handed to the writer with the cache name `"none"`,
 * meant as "keep nothing" but read by `putIfCacheable` as a real name — so
 * every authenticated page anyone opened was kept, without bound, in a cache
 * the `stoky-` purge below never matched. `caches.match` searches every cache,
 * so offline the next account on the device was served the previous one's
 * pages. Nothing writes it now; `activate` and `STOKY_FORGET` delete it.
 */
const LEGACY_UNLISTED_CACHE = "none";

/** Whether a cache is this worker's to delete. */
function isOwnCache(name) {
  return name.startsWith("stoky-") || name === LEGACY_UNLISTED_CACHE;
}

/**
 * The documents worth keeping so the app opens without a signal.
 *
 * HTML only, and only these. Every dashboard page is a client component that
 * fetches over tRPC, so the document carries no household data — which is what
 * makes caching an authenticated page defensible at all.
 */
const SHELL_ROUTES = new Set([
  "/",
  "/dashboard",
  "/inventory",
  "/shopping",
  "/products",
  "/offline",
]);

/** How long to wait for the network on a navigation before serving the shell. */
const NAVIGATION_TIMEOUT_MS = 2500;

/**
 * What to do with a request, as one word.
 *
 * Refusals come first, so a positive rule added later cannot out-rank them.
 * This is a pure function of the request so it can be tested without a browser.
 */
function classify(request, url, isSameOrigin) {
  if (request.method !== "GET") return "passthrough";

  // Cross-origin must pass through untouched. The worker's own CSP is
  // `connect-src 'self'`, which governs `fetch()` *inside* the worker — so
  // handling an images.openfoodfacts.org request here blocks it, and every
  // product image in the application goes blank. It would look exactly like an
  // Open Food Facts outage.
  if (!isSameOrigin) return "passthrough";

  // Household data and credentials. Never cached, never intercepted.
  if (url.pathname.startsWith("/api/")) return "passthrough";

  // React Server Component payloads are not documents and must not be served
  // from a document cache. Presence of the header, not its value.
  if (url.searchParams.has("_rsc")) return "passthrough";
  if (
    request.headers.get("rsc") !== null ||
    request.headers.get("next-router-prefetch") !== null ||
    request.headers.get("next-router-segment-prefetch") !== null
  ) {
    return "passthrough";
  }

  // Content-hashed, so cache-first is safe and needs no manifest.
  if (url.pathname.startsWith("/_next/static/")) return "static";
  if (url.pathname.startsWith("/_next/")) return "passthrough";

  if (request.mode === "navigate") {
    return SHELL_ROUTES.has(url.pathname) ? "shell" : "navigation";
  }

  return "passthrough";
}

/**
 * The single place anything is written to a cache.
 *
 * One call site, so "what may be stored" is one question with one answer. A
 * response that is opaque, redirected, not OK, or not HTML never lands in the
 * shell cache — and an `/api/` response never lands anywhere.
 */
async function putIfCacheable(cacheName, request, response) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (!response) return;
  if (response.type === "opaque" || response.type === "opaqueredirect") return;
  if (!response.ok) return;

  if (cacheName === SHELL_CACHE) {
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) return;
  }

  const cache = await self.caches.open(cacheName);
  await cache.put(request, response.clone());
}

/**
 * Network first, falling back to whatever was kept, then to /offline.
 *
 * `cacheName` is `null` for a navigation that is served but never kept.
 */
async function navigateWithFallback(request, cacheName) {
  const timeout = new Promise((resolve) =>
    self.setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS),
  );

  let response = null;
  try {
    response = await Promise.race([self.fetch(request), timeout]);
  } catch {
    response = null;
  }

  // Only a thrown error or the timeout falls back. A *settled* 307 — which is
  // what `/dashboard` answers when signed out — arrives as an opaqueredirect
  // with status 0, and treating that as a network failure would serve the
  // previous session's signed-in shell to a signed-out visitor.
  if (response) {
    if (cacheName !== null) await putIfCacheable(cacheName, request, response);
    return response;
  }

  const cached = await self.caches.match(request);
  if (cached) return cached;

  const offline = await self.caches.match(OFFLINE_URL);
  if (offline) return offline;

  return new self.Response("", { status: 504 });
}

async function cacheFirst(request) {
  const cached = await self.caches.match(request);
  if (cached) return cached;

  const response = await self.fetch(request);
  await putIfCacheable(STATIC_CACHE, request, response);
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await self.caches.open(SHELL_CACHE);
      // `add` rather than `addAll`: one failing route must not discard the
      // rest, and `/offline` is the one that has to be there.
      await cache.add(OFFLINE_URL).catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await self.caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              isOwnCache(name) && name !== SHELL_CACHE && name !== STATIC_CACHE,
          )
          .map((name) => self.caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  switch (classify(request, url, isSameOrigin)) {
    case "static":
      event.respondWith(cacheFirst(request));
      return;
    case "shell":
      event.respondWith(navigateWithFallback(request, SHELL_CACHE));
      return;
    case "navigation":
      // Handled, but never written: the allowlist governs what is *kept*, not
      // what is served, so an unlisted route still gets the offline page
      // rather than the browser's error.
      event.respondWith(navigateWithFallback(request, null));
      return;
    default:
      return;
  }
});

/**
 * Forget everything cached for the previous account.
 *
 * The shell is an authenticated document. Four things make keeping it
 * defensible, and this is one: it is purged when the account changes, and on
 * reaching `/login`. The others are that it carries no household data, that it
 * is HTML only over six routes, and that the cache is named and commented as
 * private. The residue, stated honestly: the shell proves *someone* was signed
 * in, and embeds the session's expiry.
 */
self.addEventListener("message", (event) => {
  if (event.data !== "STOKY_FORGET") return;
  event.waitUntil(
    (async () => {
      const names = await self.caches.keys();
      await Promise.all(
        names.filter(isOwnCache).map((name) => self.caches.delete(name)),
      );
    })(),
  );
});
