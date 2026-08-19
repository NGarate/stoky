import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * The Panel's opening: quick actions first, then alerts.
 *
 * Noel's review (2026-08-19) reshaped this screen twice over:
 *
 * - The quick actions are why someone opens the panel with hands full of
 *   shopping, so they sit above everything else.
 * - The summary tiles became *alerts*: they exist only when something needs
 *   attention, and they lead with the reason ("Hay que reponer"), not with a
 *   three-em figure. The catalogue size is not an alert — nothing about it
 *   requires action — so it is gone.
 *
 * What survives from the owner's pass (Phase 8 item 2): every alert is still
 * a door to the list showing exactly its set, and the restock alert asks the
 * server the same `needsRestock` question its destination asks, so the two
 * can never disagree by construction.
 */

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

const expiringItem = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  quantity: 1,
  unit: "L",
  daysUntilExpiry: 3,
  isExpiringSoon: false,
  location: null,
  product: { id: "p2", name: "Leche fresca" },
  ...over,
});

const expiredItem = (over: Record<string, unknown> = {}) => ({
  id: "b2",
  quantity: 1,
  unit: "tarrina",
  daysExpired: 2,
  location: null,
  product: { id: "p3", name: "Yogur natural" },
  ...over,
});

let overviewStub: {
  data: { products: ReturnType<typeof row>[]; nextCursor?: string } | undefined;
  isPending: boolean;
  error: null;
};
let expiringStub: { data: unknown[]; isPending: boolean; error: null };
let expiredStub: { data: unknown[]; isPending: boolean; error: null };

mock.module("@/lib/trpc/client", () => ({
  api: {
    inventory: {
      getStockOverview: {
        useQuery: (input: Record<string, unknown>) => {
          overviewCalls.push(input);
          return overviewStub;
        },
      },
      getExpiringItems: {
        useQuery: () => expiringStub,
      },
      getExpiredItems: {
        useQuery: () => expiredStub,
      },
    },
  },
}));

const { default: DashboardPage } = await import(
  "@/app/(dashboard)/dashboard/page"
);

beforeEach(() => {
  overviewStub = {
    data: { products: [row()] },
    isPending: false,
    error: null,
  };
  expiringStub = { data: [], isPending: false, error: null };
  expiredStub = { data: [], isPending: false, error: null };
  overviewCalls = [];
});

afterEach(cleanup);

describe("the Panel's opening order", () => {
  it("puts the quick actions above everything else", () => {
    renderWithIntl(<DashboardPage />, { locale: "es" });

    const addStock = screen.getByRole("link", { name: "Añadir stock" });
    const restockAlert = screen.getByRole("link", { name: /Hay que reponer/ });

    // The person opening this screen came to *do* something; what needs
    // attention reads second.
    expect(
      addStock.compareDocumentPosition(restockAlert) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the Panel's alerts", () => {
  it("does not present the catalogue size as an alert", () => {
    renderWithIntl(<DashboardPage />, { locale: "es" });

    // Nothing about "27 productos" requires attention; it is not an alert.
    expect(screen.queryByText(/Productos en el catálogo/)).toBeNull();
  });

  it("leads with the reason and keeps the count in words", () => {
    renderWithIntl(<DashboardPage />, { locale: "es" });

    const alert = screen.getByRole("link", { name: /Hay que reponer/ });
    expect(alert.getAttribute("href")).toBe("/inventory?filter=restock");
    expect(alert.textContent).toContain("1 producto por debajo del mínimo");
  });

  it("says when the restock count is a bound, not a total", () => {
    overviewStub.data = {
      products: Array.from({ length: 100 }, (_, i) => row({ id: `p${i}` })),
      nextCursor: "p99",
    };
    renderWithIntl(<DashboardPage />, { locale: "es" });

    expect(
      screen.getByRole("link", { name: /Hay que reponer/ }).textContent,
    ).toContain("Más de 100 productos por debajo del mínimo");
  });

  it("raises expired food as its own alert, through to the inventory", () => {
    expiredStub.data = [expiredItem()];
    renderWithIntl(<DashboardPage />, { locale: "es" });

    const alert = screen.getByRole("link", { name: /Hay comida caducada/ });
    expect(alert.getAttribute("href")).toBe("/inventory");
    expect(alert.textContent).toContain("1 lote pasado de fecha");
  });

  it("raises food about to expire separately from food already expired", () => {
    expiringStub.data = [expiringItem(), expiringItem({ id: "b3" })];
    renderWithIntl(<DashboardPage />, { locale: "es" });

    const alert = screen.getByRole("link", {
      name: /Comida a punto de caducar/,
    });
    expect(alert.getAttribute("href")).toBe("/inventory");
    expect(alert.textContent).toContain("2 lotes caducan en los próximos 7 días");
  });

  it("shows no alerts at all when nothing needs attention", () => {
    overviewStub.data = { products: [] };
    renderWithIntl(<DashboardPage />, { locale: "es" });

    // No "0 things wrong" tiles: an alert that reports nothing is noise, and
    // the sections below already say all is well in words.
    expect(screen.queryByRole("link", { name: /Hay que reponer/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /caducad/ })).toBeNull();
    expect(screen.getByText(/No falta nada/)).toBeInTheDocument();
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
