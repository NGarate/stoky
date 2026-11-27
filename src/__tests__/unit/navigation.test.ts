import { describe, expect, it } from "bun:test";
import {
  DESTINATIONS,
  PHONE_DESTINATIONS,
  SECTIONS,
  activeHref,
} from "@/components/dashboard/navigation";

/**
 * The destination model behind all three navigation tiers.
 *
 * Pure data and one function, so it is checked here rather than through a
 * rendered component: `aria-current="page"` on the wrong item, or on two items
 * at once, is a defect on every route in the application.
 */

describe("the destinations (DECISIONS.md NAVIGATION)", () => {
  it("are Inicio, Compra, Inventario, Tickets and Cocina, in that order, on every tier", () => {
    expect(DESTINATIONS.map((d) => d.href)).toEqual([
      "/dashboard",
      "/shopping",
      "/inventory",
      "/receipts",
      "/kitchen",
    ]);
  });

  it("give the phone the first four, in the same order", () => {
    // Fixed places: nothing reorders itself and there is no "Más".
    expect(PHONE_DESTINATIONS.map((d) => d.href)).toEqual([
      "/dashboard",
      "/shopping",
      "/inventory",
      "/receipts",
    ]);
  });

  it("are not Productos, Precios or Configuración", () => {
    // Productos and Precios are views of their sections, Configuración is in
    // the account panel; listing either would put it in two places at once.
    const hrefs = DESTINATIONS.map((d) => d.href);
    for (const gone of [
      "/products",
      "/prices",
      "/settings",
      "/products/scan",
    ]) {
      expect(hrefs).not.toContain(gone);
    }
  });
});

describe("activeHref", () => {
  it("matches a destination exactly", () => {
    expect(activeHref("/inventory")).toBe("/inventory");
  });

  it("keeps a section current on its nested routes", () => {
    expect(activeHref("/receipts/abc123/review")).toBe("/receipts");
    expect(activeHref("/shopping/list-1")).toBe("/shopping");
  });

  it("marks a folded view's section, on the view and on everything under it", () => {
    expect(activeHref("/products")).toBe("/inventory");
    expect(activeHref("/products/scan")).toBe("/inventory");
    expect(activeHref("/products/abc/history")).toBe("/inventory");
    expect(activeHref("/prices")).toBe("/shopping");
    expect(activeHref("/prices/product-1")).toBe("/shopping");
  });

  it("marks nothing in Configuración", () => {
    // The accepted cost: the title and the way back say where you are.
    expect(activeHref("/settings")).toBeNull();
    expect(activeHref("/settings/stores")).toBeNull();
  });

  it("does not treat a shared prefix as a match", () => {
    expect(activeHref("/prices-archive")).toBeNull();
    expect(activeHref("/productsx")).toBeNull();
  });

  it("returns null on a route that belongs to no section", () => {
    expect(activeHref("/some/other/page")).toBeNull();
  });

  it("never reports a destination that is not one", () => {
    const hrefs = DESTINATIONS.map((d) => d.href);
    const routes = [
      "/dashboard",
      "/kitchen",
      "/inventory",
      "/inventory/add",
      "/products",
      "/products/new",
      "/receipts/upload",
      "/shopping/lists",
      "/prices/product-1",
    ];

    for (const route of routes) {
      expect(hrefs).toContain(activeHref(route) ?? "none");
    }
  });
});

describe("SECTIONS", () => {
  it("open each section on its own screen, the destination the bar links to", () => {
    const hrefs = DESTINATIONS.map((d) => d.href);
    for (const section of Object.values(SECTIONS)) {
      expect(hrefs).toContain(section.views[0].href);
    }
  });
});
