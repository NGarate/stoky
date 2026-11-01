/**
 * Where "back" goes, by the screen that linked here (`?from=`).
 *
 * Most sub-pages are reached from more than one screen — adding stock from
 * the overview, the inventory, the prices page and the product itself — and a
 * back link fixed to one parent sent everybody else to a screen they had
 * never been on. So the linking screen names itself in `?from=`, and the
 * header's back link (`PageHeader`) follows it.
 *
 * `from` is a path, so a product or a shopping list can be the origin and a
 * chain survives: a product opened from the overview passes
 * `/products/x?from=%2Fdashboard` on to its history, whose back link returns
 * to the product, whose own back link still returns to the overview. It is
 * not trusted: only a same-origin path whose route is listed here is
 * followed, so the link cannot be made an open redirect, and every listed
 * route has a label that names it. Anything else falls back to the page's
 * own parent — which is named from the same table, so every way back in the
 * app speaks with one set of words (`navigation.backTo`).
 */
const ORIGINS: readonly { pattern: RegExp; labelKey: string }[] = [
  { pattern: /^\/dashboard$/, labelKey: "dashboard" },
  { pattern: /^\/inventory$/, labelKey: "inventory" },
  { pattern: /^\/kitchen$/, labelKey: "kitchen" },
  { pattern: /^\/products$/, labelKey: "products" },
  { pattern: /^\/products\/(?!new$|scan$)[\w-]+$/, labelKey: "product" },
  { pattern: /^\/prices$/, labelKey: "prices" },
  { pattern: /^\/receipts$/, labelKey: "receipts" },
  { pattern: /^\/shopping$/, labelKey: "shopping" },
  { pattern: /^\/shopping\/lists$/, labelKey: "shoppingLists" },
  { pattern: /^\/shopping\/(?!lists$)[\w-]+$/, labelKey: "shoppingList" },
  { pattern: /^\/settings$/, labelKey: "settings" },
];

const BASE = "http://stoky.invalid";

/** The origin `from` names, or `null` when it names none this app follows. */
export function originOf(
  from: string | null | undefined,
): { href: string; labelKey: string } | null {
  if (!from) return null;
  let url: URL;
  try {
    url = new URL(from, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const origin = ORIGINS.find(({ pattern }) => pattern.test(url.pathname));
  return origin
    ? { href: url.pathname + url.search, labelKey: origin.labelKey }
    : null;
}

/** `href` with `from` attached, or `href` alone when there is no origin. */
export function withFrom(href: string, from: string | null): string {
  if (!from) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}`;
}

/**
 * The current page's own origin, read at event time — for the scanner's
 * hand-off, which should keep the way back, on a prerendered page where a
 * hook would need a Suspense boundary for nothing it draws. A render uses
 * `useBack`.
 */
export function currentOrigin(): string | null {
  return (
    originOf(new URLSearchParams(window.location.search).get("from"))?.href ??
    null
  );
}

/** The same page: path and query, however the query was encoded. */
function samePlace(a: URL, b: URL): boolean {
  return (
    a.origin === b.origin &&
    a.pathname === b.pathname &&
    a.searchParams.toString() === b.searchParams.toString()
  );
}

/**
 * Go back to `href` by popping history, when the entry before this one is
 * `href`; `false`, having done nothing, when it is not.
 *
 * A link to the origin pushed a new entry instead: the list came back
 * scrolled to the top, and the system's own back — Android's gesture, the
 * browser's button — then returned to the screen just left. Popping is what
 * a back button does. It is only done when the Navigation API can say what
 * the previous entry is: "pop whenever there is history" would leave the
 * app from a link opened in a new tab or shared with its `?from=`. Without
 * the API, the caller navigates as before.
 */
export function popTo(href: string): boolean {
  if (!("navigation" in window)) return false;
  const current = navigation.currentEntry;
  const previous = current
    ? navigation.entries()[current.index - 1]?.url
    : undefined;
  if (!previous || !samePlace(new URL(previous), new URL(href, previous))) {
    return false;
  }
  window.history.back();
  return true;
}
