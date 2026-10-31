/**
 * The destinations, and which tier shows which.
 *
 * Kept apart from the components that render them because three surfaces need
 * the same list — the desktop top bar, the phone bottom bar and the tablet rail
 * — and a second copy is how one of them silently loses a route. It is also
 * plain data with no React in it, so `activeHref` and `nextSlots` can be
 * unit-tested without a DOM.
 *
 * The compact tiers show three destinations and "Más" (DESIGN_AUDIT A3.6 /
 * PROGRESS D15: seven do not fit a bottom bar at 48px targets). Which three is
 * no longer fixed: they are the three screens last used on this device, so the
 * screen you are on is always in the bar and "Más" is never where you are
 * (owner's report, 2026-10-31 — a bar whose answer to "where am I" was a dot on
 * "Más" was not answering it). Scanning is not a destination any more: it is
 * offered where a product is chosen, which is what it is for.
 */

/** One navigable section. */
export interface Destination {
  /** Route the item links to. */
  href: string;
  /** Key inside the `navigation` message namespace. */
  labelKey: string;
}

/** Everything the compact tiers can reach, in the order "Más" lists it. */
export const COMPACT_DESTINATIONS: readonly Destination[] = [
  { href: "/shopping", labelKey: "shoppingShort" },
  { href: "/inventory", labelKey: "inventory" },
  { href: "/kitchen", labelKey: "kitchen" },
  { href: "/dashboard", labelKey: "dashboard" },
  { href: "/products", labelKey: "products" },
  { href: "/receipts", labelKey: "receipts" },
  { href: "/prices", labelKey: "prices" },
  { href: "/settings", labelKey: "settings" },
];

/** The desktop top bar, which has room for all of them. */
export const DESKTOP_DESTINATIONS: readonly Destination[] = [
  { href: "/kitchen", labelKey: "kitchen" },
  { href: "/dashboard", labelKey: "dashboard" },
  { href: "/inventory", labelKey: "inventory" },
  { href: "/products", labelKey: "products" },
  { href: "/receipts", labelKey: "receipts" },
  { href: "/shopping", labelKey: "shopping" },
  { href: "/prices", labelKey: "prices" },
  { href: "/settings", labelKey: "settings" },
];

/**
 * The compact bar's three destinations.
 *
 * `hrefs` is the bar, left to right. `recent` is the same three, most recently
 * used first, which decides which one a new screen replaces.
 */
export interface Slots {
  hrefs: readonly string[];
  recent: readonly string[];
}

/** A first visit's bar: the phone's two jobs (D15), then the overview. */
export const DEFAULT_SLOTS: Slots = {
  hrefs: ["/shopping", "/inventory", "/dashboard"],
  recent: ["/shopping", "/inventory", "/dashboard"],
};

/**
 * The bar after visiting `current`.
 *
 * A screen already in the bar only becomes the most recent. One that is not
 * takes the place of the least recently used, *in that position*: the other
 * two stay where the thumb learned them, rather than every visit shuffling
 * the bar. `null` — a route that belongs to no destination — changes nothing.
 */
export function nextSlots(slots: Slots, current: string | null): Slots {
  if (current === null) return slots;

  if (slots.hrefs.includes(current)) {
    return slots.recent[0] === current
      ? slots
      : {
          hrefs: slots.hrefs,
          recent: [current, ...slots.recent.filter((href) => href !== current)],
        };
  }

  const leastRecent = slots.recent[slots.recent.length - 1];
  return {
    hrefs: slots.hrefs.map((href) => (href === leastRecent ? current : href)),
    recent: [current, ...slots.recent.slice(0, -1)],
  };
}

/**
 * A stored bar, or `null` when it is not one this version can show.
 *
 * It comes from `localStorage`, which another version of the application, or
 * somebody with the developer tools open, may have written: anything that is
 * not three distinct current destinations, in both orders, is discarded.
 */
export function parseSlots(raw: unknown): Slots | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { hrefs, recent } = raw as Record<string, unknown>;
  const known = new Set(COMPACT_DESTINATIONS.map((d) => d.href));
  const valid = (list: unknown): list is string[] =>
    Array.isArray(list) &&
    list.length === DEFAULT_SLOTS.hrefs.length &&
    new Set(list).size === list.length &&
    list.every((href) => typeof href === "string" && known.has(href));

  if (!valid(hrefs) || !valid(recent)) return null;
  if (!hrefs.every((href) => recent.includes(href))) return null;
  return { hrefs, recent };
}

/**
 * Which destination the current path belongs to, or `null` for none.
 *
 * The **longest** match wins rather than the first, so a destination nested
 * under another never lights up both — "exactly one section is current" is
 * the property `aria-current="page"` depends on being true.
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
