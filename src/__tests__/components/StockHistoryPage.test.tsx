import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import { screen, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderWithIntl } from "../utils/render";
import { Decimal } from "@prisma/client-runtime-utils";

/**
 * `/products/[id]/history` — Phase 8 item 5's genuinely new screen.
 *
 * The claim worth money is the chart's arithmetic: totals derived backwards
 * from the current net (`runningTotals`), so a partially loaded ledger draws
 * only exact points. Recharts is replaced with prop recorders, as
 * PriceChart.test does — what is under test is the page's derivation, not
 * SVG.
 */
type ChartRow = { date: string; total: number };
let chartData: ChartRow[] = [];

mock.module("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  LineChart: ({
    data,
    children,
  }: {
    data: ChartRow[];
    children: ReactNode;
  }) => {
    chartData = data;
    return <div>{children}</div>;
  },
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const entries = [
  {
    id: "e3",
    quantity: new Decimal(4),
    unit: "L",
    operationType: "PURCHASE",
    createdAt: new Date("2026-08-15T10:00:00Z"),
    location: { name: "Nevera" },
  },
  {
    id: "e2",
    quantity: new Decimal(-1),
    unit: "L",
    operationType: "CONSUME",
    createdAt: new Date("2026-08-10T10:00:00Z"),
    location: null,
  },
  {
    id: "e1",
    quantity: new Decimal(2),
    unit: "L",
    operationType: "PURCHASE",
    createdAt: new Date("2026-08-01T10:00:00Z"),
    location: { name: "Despensa" },
  },
];

let detailStub: Record<string, unknown>;
let historyStub: Record<string, unknown>;

mock.module("@/lib/trpc/client", () => ({
  api: {
    product: {
      getById: { useQuery: () => detailStub },
    },
    inventory: {
      getStockHistory: { useInfiniteQuery: () => historyStub },
    },
  },
}));

const { StockHistoryView } =
  await import("@/app/(dashboard)/products/[id]/history/page");

beforeEach(() => {
  chartData = [];
  detailStub = {
    data: {
      id: "p1",
      name: "Leche entera",
      totalStock: new Decimal(5),
      defaultUnit: "L",
    },
    isPending: false,
    error: null,
    refetch: () => {},
  };
  historyStub = {
    data: { pages: [{ entries, nextCursor: undefined }] },
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => {},
    refetch: () => {},
  };
});

afterEach(cleanup);

/** A refusal as the client receives it: the code is what RouteState reads. */
function notFoundError(): TRPCClientError<never> {
  const error = new TRPCClientError<never>("Product not found");
  Object.defineProperty(error, "data", {
    value: { code: "NOT_FOUND", httpStatus: 404 },
  });
  return error;
}

describe("the stock history", () => {
  it("charts exact running totals, derived backwards from the current net", () => {
    renderWithIntl(<StockHistoryView id="p1" />, { locale: "es" });

    // Ledger newest-first: +4, -1, +2; net now 5. Chart oldest-first:
    // after +2 → 2, after -1 → 1, after +4 → 5.
    expect(chartData.map((row) => row.total)).toEqual([2, 1, 5]);
  });

  it("shows the ledger in words, with signed deltas and what was left", () => {
    renderWithIntl(<StockHistoryView id="p1" />, { locale: "es" });

    // Scoped to the table: the same ledger is also drawn as cards for the
    // tiers below `lg`, so an unscoped query finds every value twice.
    const table = within(screen.getByRole("table"));
    expect(table.getAllByText("Compra").length).toBe(2);
    expect(table.getByText("Consumo")).toBeInTheDocument();
    expect(table.getByText("+4 L")).toBeInTheDocument();
    expect(table.getByText("-1 L")).toBeInTheDocument();
    expect(table.getByText("5 L").closest("td")).not.toBeNull();
  });

  /**
   * Five columns at 390px under `overflow-hidden` clipped "Ubicación" and
   * "Total" off the right edge — the information lost as completely as if it
   * were never sent, which is DESIGN_AUDIT A3.3's correction. The other
   * tables became cards below `lg`; this one, built later, did not.
   */
  it("is cards below lg and a table only from lg, with nothing dropped", () => {
    renderWithIntl(<StockHistoryView id="p1" />, { locale: "es" });

    const table = screen.getByRole("table");
    const tableBox = table.parentElement as HTMLElement;
    expect(tableBox.className).toContain("hidden");
    expect(tableBox.className).toContain("lg:block");

    const cards = document.querySelector<HTMLElement>("ul.lg\\:hidden");
    expect(cards).not.toBeNull();
    const rows = within(cards as HTMLElement).getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    // Every column the table carries is on each card.
    for (const row of rows) {
      const terms = within(row)
        .getAllByRole("term")
        .map((term) => term.textContent);
      expect(terms).toEqual(["Movimiento", "Cambio", "Ubicación", "Quedó"]);
    }
    expect(
      within(rows[0] as HTMLElement).getByText("Nevera"),
    ).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByText("+4 L"),
    ).toBeInTheDocument();
  });

  it("says so when there is no ledger yet, instead of an empty chart", () => {
    historyStub = { ...historyStub, data: { pages: [{ entries: [] }] } };
    renderWithIntl(<StockHistoryView id="p1" />, { locale: "es" });

    expect(screen.getByText(/Todavía no hay movimientos/)).toBeInTheDocument();
    expect(screen.queryByTestId("chart")).toBeAbsent();
  });

  /**
   * The way out was a `<Button variant="link">` wrapping a `<Link>`, so it was
   * the only kind of back link in the application with no arrow on it — the
   * others draw one from `BackLink`. Same words, same destination, three
   * different controls across five screens.
   *
   * The arrow is counted rather than assumed present: one drawn by the
   * component, and none typed into the string beside it. Both halves matter,
   * and the second is the one that shipped twice.
   */
  it("leaves by the same link every other screen leaves by", () => {
    renderWithIntl(<StockHistoryView id="p1" />, { locale: "es" });

    const back = screen.getByRole("link", { name: "Volver al producto" });

    expect(back).toHaveAttribute("href", "/products/p1");
    expect(back.querySelectorAll("svg").length).toBe(1);
    expect(back.textContent).toBe("Volver al producto");
  });

  it("says where it goes when the history could not load (WCAG 2.4.9)", () => {
    // It said "Volver al producto" and went to /products — the list, not
    // the product. After a failure the product is still the way back.
    detailStub = { ...detailStub, data: undefined, error: { message: "boom" } };
    renderWithIntl(<StockHistoryView id="p1" />, { locale: "es" });

    expect(
      screen.getByRole("link", { name: "Volver al producto" }),
    ).toHaveAttribute("href", "/products/p1");
  });

  it("goes to the products when there is no product to go back to", () => {
    detailStub = {
      ...detailStub,
      data: undefined,
      error: notFoundError(),
    };
    renderWithIntl(<StockHistoryView id="p1" />, { locale: "es" });

    expect(
      screen.getByRole("link", { name: "Volver a productos" }),
    ).toHaveAttribute("href", "/products");
  });
});
