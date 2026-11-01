import { describe, it, expect } from "bun:test";
import { originOf, withFrom } from "@/lib/back";

describe("originOf", () => {
  it("follows a listed screen, with the label that names it", () => {
    expect(originOf("/dashboard")).toEqual({
      href: "/dashboard",
      labelKey: "dashboard",
    });
    expect(originOf("/shopping/clabc123")?.labelKey).toBe("shoppingList");
    expect(originOf("/shopping/lists")?.labelKey).toBe("shoppingLists");
  });

  it("keeps the origin's own way back, so a chain survives", () => {
    expect(originOf("/products/p1?from=%2Fdashboard")).toEqual({
      href: "/products/p1?from=%2Fdashboard",
      labelKey: "product",
    });
  });

  it("does not take the product forms for a product", () => {
    expect(originOf("/products/new")).toBeNull();
    expect(originOf("/products/scan")).toBeNull();
  });

  it("refuses anything that leaves the app, or a screen it does not list", () => {
    for (const from of [
      "//evil.example/dashboard",
      "/\\evil.example/dashboard",
      "https://evil.example/dashboard",
      "javascript:alert(1)//dashboard",
      "/settings/security",
      "/products/p1/history",
      "",
      null,
      undefined,
    ]) {
      expect(originOf(from)).toBeNull();
    }
  });
});

describe("withFrom", () => {
  it("encodes the origin so its own query cannot leak into this one", () => {
    expect(withFrom("/prices/p1", "/products/p1?from=%2Fdashboard")).toBe(
      "/prices/p1?from=%2Fproducts%2Fp1%3Ffrom%3D%252Fdashboard",
    );
    expect(withFrom("/products/new?barcode=1", "/shopping")).toBe(
      "/products/new?barcode=1&from=%2Fshopping",
    );
  });

  it("leaves the link alone when there is no origin", () => {
    expect(withFrom("/inventory/add", null)).toBe("/inventory/add");
  });
});
