import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";
import { axeViolations } from "../utils/axe";
import { Decimal } from "@prisma/client-runtime-utils";

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
  data: { products: unknown[]; nextCursor?: string } | undefined;
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

const { default: ProductsPage } =
  await import("@/app/(dashboard)/products/page");

beforeEach(() => {
  listStub = {
    data: {
      products: [
        {
          id: "p1",
          name: "Leche entera",
          brand: "Pascual",
          category: "Lácteos",
          totalStock: new Decimal(2),
          minStock: new Decimal(6),
          defaultUnit: "L",
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

    // No "Editar": the catalogue fields are edited on the product itself now,
    // so a row action pointing at a second screen would point at a redirect.
    const wanted: Array<[RegExp, string]> = [
      [/Ajustar de «Leche entera»/, "/products/p1/adjust"],
      [/Historial de «Leche entera»/, "/products/p1/history"],
      [/Precios de «Leche entera»/, "/prices/p1"],
    ];
    for (const [name, href] of wanted) {
      // Both tiers now offer them. The card tier — the phone and the kitchen
      // tablet — had no row actions at all before, so a product could only be
      // adjusted from a screen wide enough for a table.
      const links = screen.getAllByRole("link", { name });
      expect(links.length).toBeGreaterThanOrEqual(2);
      for (const link of links) {
        expect(link.getAttribute("href")).toBe(href);
      }
    }
  });

  it("says the stock state in words, not only in colour", () => {
    renderWithIntl(<ProductsPage />, { locale: "es" });

    // Two litres of a minimum of six. The screen used to show "Stock: 2" in
    // amber and say nothing at all — the state was carried by the colour of
    // the number and by nothing else (WCAG 1.4.1) — and it worked the answer
    // out for itself, which made a fourth derivation of a rule that already
    // had a home in `StockStatus`.
    expect(screen.getAllByText("Queda poco").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 L").length).toBeGreaterThan(0);
  });

  it("no longer offers a separate screen to edit on", () => {
    renderWithIntl(<ProductsPage />, { locale: "es" });

    expect(screen.queryByRole("link", { name: /Editar/ })).toBeAbsent();
  });

  it("retires 'Ver' — the name is the way in", () => {
    renderWithIntl(<ProductsPage />, { locale: "es" });

    expect(screen.queryByRole("link", { name: /^Ver/ })).toBeAbsent();
    const name = screen.getAllByRole("link", { name: "Leche entera" });
    expect(name.length).toBeGreaterThanOrEqual(1);
    expect(name[0]?.getAttribute("href")).toBe("/products/p1");
  });

  it("reads the catalogue rather than hardcoded Spanish", () => {
    renderWithIntl(<ProductsPage />, { locale: "en" });

    expect(screen.getAllByText("Products").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Productos")).toBeAbsent();
    expect(screen.queryByText("Sin categoría")).toBeAbsent();
  });
});

describe("when the catalogue does not fit", () => {
  it("says it has stopped, rather than simply ending", () => {
    listStub.data = {
      products: [
        {
          id: "p1",
          name: "Leche entera",
          brand: "Pascual",
          category: "Lácteos",
          totalStock: new Decimal(2),
          minStock: new Decimal(6),
          defaultUnit: "L",
        },
      ],
      nextCursor: "p2",
    };

    renderWithIntl(<ProductsPage />, { locale: "es" });

    // The screen asked for a hundred and drew what it was given. A household
    // with more than that had a catalogue that simply ended — no page two, no
    // count, and nothing to say a product that exists is not on the screen.
    expect(
      screen.getByText(/Se muestra el primer producto/),
    ).toBeInTheDocument();
  });

  it("says nothing when everything is on the screen", () => {
    renderWithIntl(<ProductsPage />, { locale: "es" });

    expect(screen.queryByText(/Hay más en el catálogo/)).toBeAbsent();
  });
});

it("passes axe at AAA", async () => {
  const { container } = renderWithIntl(<ProductsPage />, { locale: "es" });
  await screen.findAllByRole("link", { name: "Leche entera" });
  expect(await axeViolations(container)).toBe("");
});
