/**
 * Every route's document title, in one table (WCAG 2.4.2, Level A).
 *
 * The title used to be one hardcoded English string for every route, which
 * failed twice over: a Spanish interface announced itself in English, and
 * nothing ever changed it. The second half mattered more than it looks. Next's
 * route announcer (`next/dist/client/components/app-router-announcer.js`)
 * speaks on a client navigation **only when `document.title` changes** — so
 * with one title for the whole application, moving between screens told a
 * screen-reader user nothing at all.
 *
 * Why a table rather than a `<title>` in each page: almost every page here is a
 * Client Component (`CLAUDE.md`, offline), which cannot export `metadata`, and
 * a React `<title>` rendered by each page competes with any other on the
 * document — React inserts the newest one first, so which one wins depends on
 * mount order. One component rendering one `<title>` from this table has
 * nothing to compete with, and a route added without a title fails
 * `route-titles.test.ts` instead of quietly shipping the fallback.
 *
 * Values are catalogue keys, and mostly the key the page's own `<h1>` already
 * uses, so the title and the heading cannot drift into two names for one
 * screen.
 */
export const ROUTE_TITLES: Readonly<Record<string, string>> = {
  "/login": "auth.login",
  "/register": "auth.register",
  "/start": "start.settingsTitle",
  "/offline": "offlinePage.title",
  "/dashboard": "dashboard.title",
  "/kitchen": "kitchen.title",
  "/inventory": "inventory.title",
  "/inventory/add": "inventory.add.title",
  "/inventory/consume": "inventory.consume.title",
  "/products": "products.list.title",
  "/products/new": "products.new.title",
  "/products/scan": "products.scan.title",
  "/products/[id]": "products.detail.loadingTitle",
  "/products/[id]/edit": "products.edit.title",
  "/products/[id]/adjust": "products.adjust.title",
  "/products/[id]/history": "products.history.title",
  "/prices": "prices.title",
  "/prices/[productId]": "prices.history",
  "/receipts": "receipts.title",
  "/receipts/upload": "receipts.upload",
  "/receipts/[id]/review": "receipts.review",
  "/receipts/[id]/applied": "receipts.applied.title",
  "/shopping": "shopping.shopTitle",
  "/shopping/lists": "shopping.title",
  "/shopping/[id]": "shopping.listPageTitle",
  "/settings": "settings.hub.title",
  "/settings/locations": "locations.title",
  "/settings/people": "household.peopleTitle",
  "/settings/screen": "start.settingsTitle",
  "/settings/security": "security.title",
  "/settings/stores": "stores.title",
  "/settings/unsaved": "offline.unsavedTitle",
};

/** The brand, appended to every title. A name, so never translated. */
export const TITLE_SUFFIX = "Stoky";

/** `"Inventario"` → `"Inventario · Stoky"`. */
export function documentTitle(pageTitle: string): string {
  return `${pageTitle} · ${TITLE_SUFFIX}`;
}

/**
 * The title key for a pathname, or `undefined` for one the table does not
 * name (`/`, which only redirects, and a path that is not a route).
 *
 * A static segment beats a dynamic one, so `/products/new` is never read as a
 * product whose id is `new`.
 */
export function titleKeyFor(pathname: string): string | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const exact = ROUTE_TITLES[path];
  if (exact) return exact;

  const parts = path.split("/");
  for (const [pattern, key] of Object.entries(ROUTE_TITLES)) {
    const wanted = pattern.split("/");
    if (wanted.length !== parts.length) continue;
    const matches = wanted.every((segment, index) =>
      segment.startsWith("[")
        ? (parts[index] ?? "").length > 0
        : segment === parts[index],
    );
    if (matches) return key;
  }
  return undefined;
}
