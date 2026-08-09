import { describe, expect, it } from "bun:test";
import {
  COMPACT_DESTINATIONS,
  DESKTOP_DESTINATIONS,
  PRIMARY_DESTINATIONS,
  SECONDARY_DESTINATIONS,
  activeHref,
} from "@/components/dashboard/navigation";

/**
 * The destination model behind all three navigation tiers.
 *
 * Pure data and one function, so it is checked here rather than through a
 * rendered component: `aria-current="page"` on the wrong item, or on two items
 * at once, is a defect on every route in the application.
 */

describe("activeHref", () => {
  it("matches a destination exactly", () => {
    expect(activeHref("/inventory", COMPACT_DESTINATIONS)).toBe("/inventory");
  });

  it("keeps a section current on its nested routes", () => {
    expect(activeHref("/receipts/abc123/review", DESKTOP_DESTINATIONS)).toBe(
      "/receipts",
    );
  });

  it("prefers the longest match, so scanning does not also light up products", () => {
    // Both "/products" and "/products/scan" are destinations in the compact
    // tiers. A first-match rule would make two items current at once.
    expect(activeHref("/products/scan", COMPACT_DESTINATIONS)).toBe(
      "/products/scan",
    );
  });

  it("falls back to the parent section for a route with no slot of its own", () => {
    expect(activeHref("/products/new", COMPACT_DESTINATIONS)).toBe("/products");
  });

  it("does not treat a shared prefix as a match", () => {
    // "/prices" must not claim "/prices-archive", and "/products" must never
    // claim "/prices".
    expect(activeHref("/prices-archive", DESKTOP_DESTINATIONS)).toBeNull();
    expect(activeHref("/prices", DESKTOP_DESTINATIONS)).toBe("/prices");
  });

  it("returns null on a route that belongs to no section", () => {
    expect(activeHref("/some/other/page", DESKTOP_DESTINATIONS)).toBeNull();
  });

  it("never reports more than one current destination", () => {
    const routes = [
      "/dashboard",
      "/inventory",
      "/inventory/add",
      "/products",
      "/products/new",
      "/products/scan",
      "/receipts",
      "/receipts/upload",
      "/shopping",
      "/shopping/list-1",
      "/prices",
      "/prices/product-1",
      "/settings",
      "/settings/stores",
    ];

    for (const route of routes) {
      const current = activeHref(route, COMPACT_DESTINATIONS);
      const matches = COMPACT_DESTINATIONS.filter(
        (destination) => destination.href === current,
      );
      expect(matches).toHaveLength(1);
    }
  });
});

describe("destination lists", () => {
  it("gives the phone four slots: three destinations plus Más", () => {
    // PROGRESS D15: seven destinations do not fit a bottom bar at 48px targets
    // on a 390px screen, and the phone answers "what do I need to buy".
    expect(PRIMARY_DESTINATIONS.map((d) => d.href)).toEqual([
      "/shopping",
      "/inventory",
      "/products/scan",
    ]);
  });

  it("reaches every desktop destination from the compact tiers", () => {
    const compact = new Set(COMPACT_DESTINATIONS.map((d) => d.href));

    // The bar hides destinations; it must never delete them. This is the
    // regression that ISSUES.md NAV-1 was.
    for (const destination of DESKTOP_DESTINATIONS) {
      expect(compact.has(destination.href)).toBe(true);
    }
  });

  it("lists no destination twice", () => {
    const hrefs = COMPACT_DESTINATIONS.map((d) => d.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("puts nothing in both the bar and the sheet", () => {
    const primary = new Set(PRIMARY_DESTINATIONS.map((d) => d.href));
    for (const destination of SECONDARY_DESTINATIONS) {
      expect(primary.has(destination.href)).toBe(false);
    }
  });
});
