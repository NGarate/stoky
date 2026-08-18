import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * The Panel's stat cards — Phase 8 item 2.
 *
 * They were inert `<li>`s over numbers people act on. Two things are pinned:
 * every card is a *door* (a link to the list showing what it counts), and the
 * numbers are truthful — the catalogue card shows `product.count`, not the
 * length of a 100-row first page, and the restock card asks the server the
 * same `needsRestock` question its destination asks, so the two can never
 * disagree by construction.
 */

let countStub: { data: number | undefined; isPending: boolean; error: null };
let overviewCalls: Array<Record<string, unknown>>;

const row = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Café molido",
  totalStock: 0,
  minStock: 2,
  defaultUnit: "paquete",
  isLowStock: false,
  ...over,
});

let overviewStub: {
  data: { products: ReturnType<typeof row>[]; nextCursor?: string } | undefined;
  isPending: boolean;
  error: null;
};

mock.module("@/lib/trpc/client", () => ({
  api: {
    product: {
      count: { useQuery: () => countStub },
    },
    inventory: {
      getStockOverview: {
        useQuery: (input: Record<string, unknown>) => {
          overviewCalls.push(input);
          return overviewStub;
        },
      },
      getExpiringItems: {
        useQuery: () => ({ data: [], isPending: false, error: null }),
      },
      getExpiredItems: {
        useQuery: () => ({ data: [], isPending: false, error: null }),
      },
    },
  },
}));

const { default: DashboardPage } = await import(
  "@/app/(dashboard)/dashboard/page"
);

beforeEach(() => {
  countStub = { data: 27, isPending: false, error: null };
  overviewStub = {
    data: { products: [row()] },
    isPending: false,
    error: null,
  };
  overviewCalls = [];
});

afterEach(cleanup);

describe("the Panel's stat cards", () => {
  it("makes every card a door to the list it counts", () => {
    renderWithIntl(<DashboardPage />, { locale: "es" });

    const products = screen.getByRole("link", {
      name: /Productos en el catálogo/,
    });
    expect(products.getAttribute("href")).toBe("/products");

    const restock = screen.getByRole("link", { name: /Necesitan reposición/ });
    expect(restock.getAttribute("href")).toBe("/inventory?filter=restock");

    const atRisk = screen.getByRole("link", { name: /Caducados o que caducan/ });
    expect(atRisk.getAttribute("href")).toBe("/inventory");
  });

  it("shows the real catalogue count, not the page length", () => {
    // One product in the overview page; 27 in the household. The card must say
    // 27 — the page length was the old, quietly-wrong number.
    renderWithIntl(<DashboardPage />, { locale: "es" });

    const products = screen.getByRole("link", {
      name: /Productos en el catálogo/,
    });
    expect(products.textContent).toContain("27");
  });

  it("asks the server the same restock question its destination asks", () => {
    renderWithIntl(<DashboardPage />, { locale: "es" });

    expect(
      overviewCalls.some(
        (input) => input.needsRestock === true && input.limit === 100,
      ),
    ).toBe(true);
  });
});
