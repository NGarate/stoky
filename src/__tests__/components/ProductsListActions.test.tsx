import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * The catalogue's Acciones column — Phase 8 item 5.
 *
 * "Ver" (a second link to where the name already points, and A4.5's example
 * of a WCAG 2.4.9 failure) is gone; in its place, the row's real actions,
 * each carrying the product's name for a screen reader. The page also stops
 * being the last hardcoded-Spanish one, so the assertions here run against
 * the catalogue in both languages.
 */
let listStub: {
  data: { products: unknown[] } | undefined;
  isPending: boolean;
  error: null;
  fetchStatus: "idle";
  refetch: () => void;
};

mock.module("@/lib/trpc/client", () => ({
  api: {
    product: {
      list: { useQuery: () => listStub },
    },
  },
}));

const { default: ProductsPage } = await import("@/app/(dashboard)/products/page");

beforeEach(() => {
  listStub = {
    data: {
      products: [
        {
          id: "p1",
          name: "Leche entera",
          brand: "Pascual",
          category: "Lácteos",
          totalStock: 2,
          minStock: 6,
        },
      ],
    },
    isPending: false,
    error: null,
    fetchStatus: "idle",
    refetch: () => {},
  };
});

afterEach(cleanup);

describe("the catalogue's actions column", () => {
  it("offers the row's real actions, each named with its product", () => {
    renderWithIntl(<ProductsPage />, { locale: "es" });

    const wanted: Array<[RegExp, string]> = [
      [/Editar de «Leche entera»/, "/products/p1/edit"],
      [/Ajustar de «Leche entera»/, "/products/p1/adjust"],
      [/Historial de «Leche entera»/, "/products/p1/history"],
      [/Precios de «Leche entera»/, "/prices/p1"],
    ];
    for (const [name, href] of wanted) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
    }
  });

  it("retires 'Ver' — the name is the way in", () => {
    renderWithIntl(<ProductsPage />, { locale: "es" });

    expect(screen.queryByRole("link", { name: /^Ver/ })).toBeNull();
    const name = screen.getAllByRole("link", { name: "Leche entera" });
    expect(name.length).toBeGreaterThanOrEqual(1);
    expect(name[0]?.getAttribute("href")).toBe("/products/p1");
  });

  it("reads the catalogue rather than hardcoded Spanish", () => {
    renderWithIntl(<ProductsPage />, { locale: "en" });

    expect(screen.getAllByText("Products").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Productos")).toBeNull();
    expect(screen.queryByText("Sin categoría")).toBeNull();
  });
});
