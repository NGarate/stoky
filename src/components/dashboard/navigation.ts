/**
 * The destinations, and which tier shows which.
 *
 * Kept apart from the components that render them because three surfaces need
 * the same list — the desktop top bar, the phone bottom bar and the tablet rail
 * — and a second copy is how one of them silently loses a route. It is also
 * plain data with no React in it, so `activeHref` can be unit-tested without a
 * DOM.
 *
 * The split into primary and secondary is DESIGN_AUDIT A3.6 / PROGRESS D15:
 * the phone answers "what do I need to buy", so it carries Compra, Inventario
 * and Escanear, and everything else lives behind "Más". The tablet rail carries
 * the same four, because the kitchen tier is the *least* dense of the three
 * (D14) — a rail has room for seven, which is exactly why it should not use it.
 */

/** One navigable section. */
export interface Destination {
  /** Route the item links to. */
  href: string;
  /** Key inside the `navigation` message namespace. */
  labelKey: string;
}

/**
 * The compact tiers' visible destinations.
 *
 * Scanning earns a slot of its own even though it lives under `/products`,
 * because it is the phone's primary action (REDESIGN_PLAN §3) and burying it
 * one level down would make the phone worse at the one job it has.
 */
export const PRIMARY_DESTINATIONS: readonly Destination[] = [
  { href: "/shopping", labelKey: "shoppingShort" },
  { href: "/inventory", labelKey: "inventory" },
  { href: "/products/scan", labelKey: "scan" },
];

/** Everything the "Más" sheet holds, in the order it is read. */
export const SECONDARY_DESTINATIONS: readonly Destination[] = [
  { href: "/dashboard", labelKey: "dashboard" },
  { href: "/products", labelKey: "products" },
  { href: "/receipts", labelKey: "receipts" },
  { href: "/prices", labelKey: "prices" },
  { href: "/settings", labelKey: "settings" },
];

/** The desktop top bar, which has room for all of them. */
export const DESKTOP_DESTINATIONS: readonly Destination[] = [
  { href: "/dashboard", labelKey: "dashboard" },
  { href: "/inventory", labelKey: "inventory" },
  { href: "/products", labelKey: "products" },
  { href: "/receipts", labelKey: "receipts" },
  { href: "/shopping", labelKey: "shopping" },
  { href: "/prices", labelKey: "prices" },
  { href: "/settings", labelKey: "settings" },
];

/** Primary plus secondary — every destination the compact tiers can reach. */
export const COMPACT_DESTINATIONS: readonly Destination[] = [
  ...PRIMARY_DESTINATIONS,
  ...SECONDARY_DESTINATIONS,
];

/**
 * Which destination the current path belongs to, or `null` for none.
 *
 * The **longest** match wins rather than the first. `/products/scan` is a
 * destination in its own right and `/products` is its prefix, so a first-match
 * rule would light up two items at once — and "exactly one section is current"
 * is the property `aria-current="page"` depends on being true.
 *
 * Matching is on whole segments (`===` or a `/` boundary) so `/prices` never
 * claims `/prices-archive`, and `/products` never claims `/prices`.
 */
export function activeHref(
  pathname: string,
  destinations: readonly Destination[],
): string | null {
  let best: string | null = null;

  for (const destination of destinations) {
    const matches =
      pathname === destination.href ||
      pathname.startsWith(`${destination.href}/`);

    if (matches && (best === null || destination.href.length > best.length)) {
      best = destination.href;
    }
  }

  return best;
}
