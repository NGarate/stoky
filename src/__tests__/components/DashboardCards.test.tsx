import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * The Panel's opening: quick actions first, then one line of summary.
 *
 * Noel's second review (2026-08-19) removed what the first one had left: the
 * alert rows were cards restating the lists rendered directly below them, and
 * a screen that says everything twice is harder to read, not safer. What
 * needs attention is now one short sentence — a summary, not a set of doors,
 * because the sections underneath are already the doors. The scan quick
 * action went with it: on a phone, Escanear is permanently in the bottom
 * bar, and this screen is the desktop overview, where there is no camera.
 *
 * What survives from the owner's pass (Phase 8 item 2): the summary asks the
 * server the same `needsRestock` question the inventory's restock filter
 * asks, so the number and the list it describes cannot disagree.
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
    const summary = screen.getByText(/por reponer/);

    // The person opening this screen came to *do* something; what needs
    // attention reads second.
    expect(
      addStock.compareDocumentPosition(summary) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not offer scanning: the phone's bar has it, the desktop no camera", () => {
    renderWithIntl(<DashboardPage />, { locale: "es" });

    expect(
      screen.queryByRole("link", { name: "Escanear un código" }),
    ).toBeNull();
    // The other three actions have no other home on this tier and stay.
    expect(screen.getByRole("link", { name: "Añadir stock" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Consumir stock" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Subir un ticket" })).toBeInTheDocument();
  });
});

describe("the Panel's summary line", () => {
  it("does not present the catalogue size as needing attention", () => {
    renderWithIntl(<DashboardPage />, { locale: "es" });

    // Nothing about "27 productos" requires attention; it is not news.
    expect(screen.queryByText(/Productos en el catálogo/)).toBeNull();
  });

  it("folds everything needing attention into one sentence, not cards", () => {
    expiredStub.data = [expiredItem()];
    expiringStub.data = [expiringItem(), expiringItem({ id: "b3" })];
    renderWithIntl(<DashboardPage />, { locale: "es" });

    const summary = screen.getByText(
      "1 lote caducado · 2 lotes caducan pronto · 1 producto por reponer",
    );
    // A summary, not a door: the sections below are the doors, and a second
    // set of links restating them was the redundancy Noel struck.
    expect(summary.closest("a")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Hay que reponer/ }),
    ).toBeNull();
  });

  it("says when the restock count is a bound, not a total", () => {
    overviewStub.data = {
      products: Array.from({ length: 100 }, (_, i) => row({ id: `p${i}` })),
      nextCursor: "p99",
    };
    renderWithIntl(<DashboardPage />, { locale: "es" });

    expect(
      screen.getByText(/más de 100 productos por reponer/),
    ).toBeInTheDocument();
  });

  it("shows no summary at all when nothing needs attention", () => {
    overviewStub.data = { products: [] };
    renderWithIntl(<DashboardPage />, { locale: "es" });

    // No "0 things wrong" line: the sections below already say all is well.
    // (The patterns are the summary's own words — "No hay nada caducado", the
    // empty section's sentence, must not trip them.)
    expect(screen.queryByText(/por reponer/)).toBeNull();
    expect(screen.queryByText(/lotes? caducad/)).toBeNull();
    expect(screen.getByText(/No falta nada/)).toBeInTheDocument();
  });

  it("asks the server the same restock question the inventory filter asks", () => {
    renderWithIntl(<DashboardPage />, { locale: "es" });

    expect(
      overviewCalls.some(
        (input) => input.needsRestock === true && input.limit === 100,
      ),
    ).toBe(true);
  });
});

describe("the Panel's lists", () => {
  it("offers the overflow as a door to the filtered inventory", () => {
    overviewStub.data = {
      products: Array.from({ length: 7 }, (_, i) => row({ id: `p${i}` })),
    };
    renderWithIntl(<DashboardPage />, { locale: "es" });

    // Five rows show; the way to the other two must exist, because the alert
    // row that used to be this door is gone.
    const more = screen.getByRole("link", {
      name: "Ver los 2 productos restantes en el inventario",
    });
    expect(more.getAttribute("href")).toBe("/inventory?filter=restock");
  });

  it("draws its lists as lists, not as cards", () => {
    expiredStub.data = [expiredItem()];
    renderWithIntl(<DashboardPage />, { locale: "es" });

    // Noel's rule (2026-08-19): a card around every list is visual overhead,
    // not structure. Rows separate with dividers (`divide-border` is the
    // dividers' colour, not a box); the border box itself is gone.
    for (const list of screen.getAllByRole("list")) {
      expect(list.className).not.toMatch(/bg-card|rounded|(?:^| )border(?: |$)/);
    }
  });
});
