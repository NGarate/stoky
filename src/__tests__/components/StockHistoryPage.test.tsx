import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderWithIntl } from "../utils/render";

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
  LineChart: ({ data, children }: { data: ChartRow[]; children: ReactNode }) => {
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
    quantity: 4,
    unit: "L",
    operationType: "PURCHASE",
    createdAt: new Date("2026-08-15T10:00:00Z"),
    location: { name: "Nevera" },
  },
  {
    id: "e2",
    quantity: -1,
    unit: "L",
    operationType: "CONSUME",
    createdAt: new Date("2026-08-10T10:00:00Z"),
    location: null,
  },
  {
    id: "e1",
    quantity: 2,
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

const { StockHistoryView } = await import(
  "@/app/(dashboard)/products/[id]/history/page"
);

beforeEach(() => {
  chartData = [];
  detailStub = {
    data: { id: "p1", name: "Leche entera", totalStock: 5, defaultUnit: "L" },
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

describe("the stock history", () => {
  it("charts exact running totals, derived backwards from the current net", () => {
    renderWithIntl(<StockHistoryView id="p1" />, { locale: "es" });

    // Ledger newest-first: +4, -1, +2; net now 5. Chart oldest-first:
    // after +2 → 2, after -1 → 1, after +4 → 5.
    expect(chartData.map((row) => row.total)).toEqual([2, 1, 5]);
  });

  it("shows the ledger in words, with signed deltas and what was left", () => {
    renderWithIntl(<StockHistoryView id="p1" />, { locale: "es" });

    expect(screen.getAllByText("Compra").length).toBe(2);
    expect(screen.getByText("Consumo")).toBeInTheDocument();
    expect(screen.getByText("+4 L")).toBeInTheDocument();
    expect(screen.getByText("-1 L")).toBeInTheDocument();
    expect(screen.getByText("5 L").closest("td")).not.toBeNull();
  });

  it("says so when there is no ledger yet, instead of an empty chart", () => {
    historyStub = { ...historyStub, data: { pages: [{ entries: [] }] } };
    renderWithIntl(<StockHistoryView id="p1" />, { locale: "es" });

    expect(screen.getByText(/Todavía no hay movimientos/)).toBeInTheDocument();
    expect(screen.queryByTestId("chart")).toBeNull();
  });
});
