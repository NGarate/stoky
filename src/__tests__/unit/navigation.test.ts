import { describe, expect, it } from "bun:test";
import {
  COMPACT_DESTINATIONS,
  DEFAULT_SLOTS,
  DESKTOP_DESTINATIONS,
  activeHref,
  nextSlots,
  parseSlots,
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

  it("prefers the longest match, so a nested destination lights up alone", () => {
    const nested = [
      { href: "/products", labelKey: "products" },
      { href: "/products/scan", labelKey: "scan" },
    ];
    expect(activeHref("/products/scan", nested)).toBe("/products/scan");
  });

  it("files scanning under products, now it has no slot of its own", () => {
    expect(activeHref("/products/scan", COMPACT_DESTINATIONS)).toBe(
      "/products",
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

  it("no longer offers scanning as a place to go", () => {
    // It is offered where a product is chosen (owner's report, 2026-10-31).
    for (const list of [COMPACT_DESTINATIONS, DESKTOP_DESTINATIONS]) {
      expect(list.map((d) => d.href)).not.toContain("/products/scan");
    }
  });
});

describe("nextSlots", () => {
  it("starts with the phone's two jobs and the overview", () => {
    expect(DEFAULT_SLOTS.hrefs).toEqual([
      "/shopping",
      "/inventory",
      "/dashboard",
    ]);
  });

  it("puts a screen that is not in the bar in place of the least recently used", () => {
    const next = nextSlots(DEFAULT_SLOTS, "/products");

    // "/dashboard" was last in `recent`; the other two keep their places.
    expect(next.hrefs).toEqual(["/shopping", "/inventory", "/products"]);
    expect(next.recent).toEqual(["/products", "/shopping", "/inventory"]);
  });

  it("replaces by recency, not by position", () => {
    const used = nextSlots(DEFAULT_SLOTS, "/dashboard");
    expect(used.hrefs).toEqual(DEFAULT_SLOTS.hrefs);

    // Inventory is now the least recent, so it is the one to go.
    expect(nextSlots(used, "/receipts").hrefs).toEqual([
      "/shopping",
      "/receipts",
      "/dashboard",
    ]);
  });

  it("always shows the screen you are on", () => {
    let slots = DEFAULT_SLOTS;
    for (const destination of COMPACT_DESTINATIONS) {
      slots = nextSlots(slots, destination.href);
      expect(slots.hrefs).toContain(destination.href);
      expect(new Set(slots.hrefs).size).toBe(3);
    }
  });

  it("changes nothing for a route that is no destination", () => {
    expect(nextSlots(DEFAULT_SLOTS, null)).toBe(DEFAULT_SLOTS);
  });
});

describe("parseSlots", () => {
  it("accepts a bar it wrote", () => {
    const slots = nextSlots(DEFAULT_SLOTS, "/prices");
    expect(parseSlots(JSON.parse(JSON.stringify(slots)))).toEqual(slots);
  });

  it("refuses anything that is not three distinct destinations, in both orders", () => {
    const cases: unknown[] = [
      null,
      "x",
      {
        hrefs: ["/shopping", "/inventory"],
        recent: ["/shopping", "/inventory"],
      },
      {
        hrefs: ["/shopping", "/shopping", "/inventory"],
        recent: ["/shopping", "/shopping", "/inventory"],
      },
      {
        hrefs: ["/products/scan", "/inventory", "/dashboard"],
        recent: ["/products/scan", "/inventory", "/dashboard"],
      },
      {
        hrefs: ["https://evil.example", "/inventory", "/dashboard"],
        recent: ["https://evil.example", "/inventory", "/dashboard"],
      },
      {
        hrefs: ["/shopping", "/inventory", "/dashboard"],
        recent: ["/shopping", "/inventory", "/prices"],
      },
    ];
    for (const raw of cases) {
      expect(parseSlots(raw)).toBeNull();
    }
  });
});
