/**
 * The destinations, and which tier shows which.
 *
 * Kept apart from the components that render them because three surfaces need
 * the same list — the desktop top bar, the phone bottom bar and the tablet rail
 * — and a second copy is how one of them silently loses a route. It is also
 * plain data with no React in it, so `activeHref` can be unit-tested without a
 * DOM.
 *
 * One list, in one order, on every tier (`DECISIONS.md` NAVIGATION,
 * arrangement B, owner, 2026-11-27): Inicio, Compra, Inventario, Tickets and
 * Cocina. The phone's bar shows the first four, always in the same place —
 * it used to show the three screens last used on the device and "Más", so
 * what was in it moved as a side effect of looking at something (PROGRESS
 * D15, now superseded). The tablet's rail and the desktop's top bar have room
 * for the fifth, the kitchen screen, which is what the tablet is for (SCREENS);
 * on the phone it is in the account panel, with Configuración, which no tier
 * lists as a destination any more.
 *
 * Productos and Precios are no destinations either: each is the second view
 * of a section (`SECTIONS`), and a route of theirs marks the section.
 */

/** One navigable section. */
export interface Destination {
  /** Route the item links to. */
  href: string;
  /** Key inside the `navigation` message namespace. */
  labelKey: string;
}

/**
 * The sections that hold two views: their own screen, and the one folded into
 * it, which stops being a destination of its own (`DECISIONS.md` NAVIGATION).
 * Each view keeps its own address, so links, back links and the offline cache
 * that name `/products` or `/prices` still lead where they did.
 */
export interface Section {
  /** The section's name, in the `navigation` namespace. */
  labelKey: string;
  /** Its views, its own screen first. */
  views: readonly Destination[];
}

export const SECTIONS = {
  inventory: {
    labelKey: "inventory",
    views: [
      { href: "/inventory", labelKey: "stockView" },
      { href: "/products", labelKey: "products" },
    ],
  },
  shopping: {
    labelKey: "shoppingShort",
    views: [
      { href: "/shopping", labelKey: "listsView" },
      { href: "/prices", labelKey: "prices" },
    ],
  },
} as const satisfies Record<string, Section>;

/** Every tier's destinations, in every tier's order. */
export const DESTINATIONS: readonly Destination[] = [
  { href: "/dashboard", labelKey: "dashboard" },
  { href: "/shopping", labelKey: "shoppingShort" },
  { href: "/inventory", labelKey: "inventory" },
  { href: "/receipts", labelKey: "receipts" },
  { href: "/kitchen", labelKey: "kitchen" },
];

/** The kitchen screen: in the rail and the top bar, in the phone's account panel. */
const KITCHEN = "/kitchen";

/** The phone's bar: every destination but the kitchen, which does not fit a thumb's four. */
export const PHONE_DESTINATIONS: readonly Destination[] = DESTINATIONS.filter(
  (destination) => destination.href !== KITCHEN,
);

/** The routes a destination is current on: its own, and its section's views'. */
function routesOf(href: string): readonly string[] {
  const section = Object.values(SECTIONS).find(
    (candidate) => candidate.views[0].href === href,
  );
  return section ? section.views.map((view) => view.href) : [href];
}

/**
 * Which destination the current path belongs to, or `null` for none —
 * Configuración and everything under it, which the bar does not mark
 * (`DECISIONS.md` NAVIGATION: the title and the way back say where you are).
 *
 * A folded view's routes belong to their section, so `/products/scan` marks
 * Inventario and `/prices/…` marks Compra.
 *
 * The **longest** match wins rather than the first, so a route nested under
 * two never lights up both — "exactly one section is current" is the property
 * `aria-current="page"` depends on being true.
 *
 * Matching is on whole segments (`===` or a `/` boundary) so `/prices` never
 * claims `/prices-archive`, and `/products` never claims `/prices`.
 */
export function activeHref(pathname: string): string | null {
  let best: string | null = null;
  let bestLength = -1;

  for (const destination of DESTINATIONS) {
    for (const route of routesOf(destination.href)) {
      const matches = pathname === route || pathname.startsWith(`${route}/`);
      if (matches && route.length > bestLength) {
        best = destination.href;
        bestLength = route.length;
      }
    }
  }

  return best;
}
