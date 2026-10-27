import { describe, expect, it } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import es from "../../../messages/es.json";
import en from "../../../messages/en.json";
import { ROUTE_TITLES, documentTitle, titleKeyFor } from "@/lib/route-titles";

/**
 * WCAG 2.4.2: every route has a title of its own.
 *
 * The browser half — that the title is the one the document actually wears,
 * and that it changes on a client navigation — is not tested. This half is the
 * one a browser cannot answer cheaply: that *no* route was
 * left out. A page added without a row in the table would otherwise ship
 * wearing the fallback, which reads as a title and names nothing.
 */

const APP_ROOT = join(import.meta.dir, "../../app");

/** `src/app/(dashboard)/products/[id]/page.tsx` → `/products/[id]`. */
function routesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      routesUnder(path, found);
    } else if (entry === "page.tsx") {
      const segments = relative(APP_ROOT, dir)
        .split(sep)
        .filter((segment) => segment && !segment.startsWith("("));
      found.push(`/${segments.join("/")}`);
    }
  }
  return found;
}

/** `/` only redirects; it is never on screen long enough to need a title. */
const ROUTES = routesUnder(APP_ROOT).filter((route) => route !== "/");

function lookup(catalogue: Record<string, unknown>, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      catalogue,
    );
}

describe("route titles", () => {
  it("finds the routes, so the sweep is not vacuous", () => {
    expect(ROUTES.length).toBeGreaterThan(25);
    expect(ROUTES).toContain("/products/[id]/adjust");
  });

  it("gives every route a title", () => {
    const untitled = ROUTES.filter((route) => !(route in ROUTE_TITLES));
    expect(untitled).toEqual([]);
  });

  it("names no route that does not exist", () => {
    // A row left behind by a deleted page is harmless at runtime and a lie in
    // the table, which is where the next person will look.
    const stale = Object.keys(ROUTE_TITLES).filter(
      (route) => !ROUTES.includes(route),
    );
    expect(stale).toEqual([]);
  });

  it("uses keys both catalogues hold", () => {
    for (const catalogue of [es, en]) {
      const missing = Object.values(ROUTE_TITLES).filter(
        (key) => typeof lookup(catalogue, key) !== "string",
      );
      expect(missing).toEqual([]);
    }
  });

  it("resolves a real path to its route's key", () => {
    expect(titleKeyFor("/inventory")).toBe("inventory.title");
    expect(titleKeyFor("/products/cm123abc/history")).toBe(
      "products.history.title",
    );
    expect(titleKeyFor("/shopping/cm123abc")).toBe("shopping.listPageTitle");
    expect(titleKeyFor("/settings/stores/")).toBe("stores.title");
  });

  it("prefers a static segment to a dynamic one", () => {
    // `/products/[id]` would also match these. A product called "new" does
    // not exist; the form does.
    expect(titleKeyFor("/products/new")).toBe("products.new.title");
    expect(titleKeyFor("/products/scan")).toBe("products.scan.title");
    expect(titleKeyFor("/shopping/lists")).toBe("shopping.title");
  });

  it("names nothing it does not know", () => {
    expect(titleKeyFor("/")).toBeUndefined();
    expect(titleKeyFor("/no/such/route")).toBeUndefined();
    expect(titleKeyFor("/products//history")).toBeUndefined();
  });

  it("puts the page before the brand", () => {
    // The page first: a list of tabs, or a reader skimming titles, reads the
    // distinguishing word before the one every tab shares.
    expect(documentTitle("Inventario")).toBe("Inventario · Stoky");
  });
});
