import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * Recharts renders through SVG measurement that happy-dom cannot perform, so
 * the chart primitives are replaced with prop recorders. What is under test is
 * PriceChart's own work: reshaping price records into chart rows and deciding
 * how many series to draw.
 */
type ChartRow = { date: string; [key: string]: string | number };

let chartData: ChartRow[] = [];
let lineProps: Array<{
  dataKey: string;
  stroke: string;
  dot?: unknown;
  activeDot?: unknown;
}> = [];
let gridProps: { strokeDasharray?: string } | undefined;
let legendRendered = false;
let yTickFormatter: ((value: number) => string) | undefined;

mock.module("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  LineChart: ({ data, children }: { data: ChartRow[]; children: ReactNode }) => {
    chartData = data;
    return <div>{children}</div>;
  },
  Line: (props: {
    dataKey: string;
    stroke: string;
    dot?: unknown;
    activeDot?: unknown;
  }) => {
    lineProps.push(props);
    return null;
  },
  XAxis: () => null,
  YAxis: (props: { tickFormatter?: (value: number) => string }) => {
    yTickFormatter = props.tickFormatter;
    return null;
  },
  CartesianGrid: (props: { strokeDasharray?: string }) => {
    gridProps = props;
    return null;
  },
  Tooltip: () => null,
  Legend: () => {
    legendRendered = true;
    return null;
  },
}));

const { PriceChart } = await import("@/components/price/PriceChart");

const data = [
  { date: "2026-01-05T00:00:00.000Z", price: 1.19, storeName: "Mercadona" },
  { date: "2026-01-05T00:00:00.000Z", price: 1.25, storeName: "Carrefour" },
  { date: "2026-02-10T00:00:00.000Z", price: 1.09, storeName: "Mercadona" },
];

beforeEach(() => {
  chartData = [];
  lineProps = [];
  gridProps = undefined;
  legendRendered = false;
  yTickFormatter = undefined;
});

afterEach(cleanup);

describe("PriceChart", () => {
  it("plots one point per record in single-series mode", () => {
    renderWithIntl(<PriceChart data={data} />);

    expect(chartData).toHaveLength(3);
    expect(chartData.map((row) => row.price)).toEqual([1.19, 1.25, 1.09]);
  });

  it("draws a single price series by default", () => {
    renderWithIntl(<PriceChart data={data} />);

    expect(lineProps).toHaveLength(1);
    expect(lineProps[0]?.dataKey).toBe("price");
  });

  it("collapses records onto one row per date when comparing stores", () => {
    renderWithIntl(<PriceChart data={data} showStores />);

    // Two distinct dates, with the same-day stores merged into one row.
    expect(chartData).toHaveLength(2);
    expect(chartData[0]?.Mercadona).toBe(1.19);
    expect(chartData[0]?.Carrefour).toBe(1.25);
    expect(chartData[1]?.Mercadona).toBe(1.09);
    expect(chartData[1]?.Carrefour).toBeUndefined();
  });

  it("draws one series per distinct store when comparing", () => {
    renderWithIntl(<PriceChart data={data} showStores />);

    expect(lineProps.map((line) => line.dataKey)).toEqual([
      "Mercadona",
      "Carrefour",
    ]);
  });

  it("gives each store series a distinct colour", () => {
    renderWithIntl(<PriceChart data={data} showStores />);

    const strokes = lineProps.map((line) => line.stroke);
    expect(new Set(strokes).size).toBe(strokes.length);
  });

  it("names a record with no store in the reader's language", () => {
    renderWithIntl(
      <PriceChart
        data={[{ date: "2026-01-05T00:00:00.000Z", price: 2 }]}
        showStores
      />,
    );

    // It used to be the literal "Unknown" — an English word in a Spanish
    // application, in a legend entry nobody could act on.
    expect(lineProps.map((line) => line.dataKey)).toEqual([
      "Tienda desconocida",
    ]);
  });

  it("only shows the legend in store-comparison mode", () => {
    renderWithIntl(<PriceChart data={data} />);
    expect(legendRendered).toBe(false);

    cleanup();
    renderWithIntl(<PriceChart data={data} showStores />);
    expect(legendRendered).toBe(true);
  });

  it("formats the price axis the way the reader's language writes money", () => {
    renderWithIntl(<PriceChart data={data} />);

    // Not "€1.50". `renderWithIntl` renders in Spanish, which puts the symbol
    // after the number and separates decimals with a comma. The axis used to
    // be hand-written as `€${n.toFixed(2)}`, which is a format no Spanish
    // reader uses — and which no assertion noticed because this one asserted
    // it too. The space before the symbol is U+00A0, which is what Intl emits.
    const tick = yTickFormatter?.(1.5) ?? "";
    expect(tick).toContain("1,50");
    expect(tick.indexOf("€")).toBeGreaterThan(tick.indexOf("1,50"));
  });

  it("renders an empty chart without crashing", () => {
    renderWithIntl(<PriceChart data={[]} />);

    expect(chartData).toEqual([]);
    expect(lineProps).toHaveLength(1);
  });

  it("gives a single observation a marker big enough to be a series", () => {
    renderWithIntl(
      <PriceChart
        data={[
          { date: "2026-01-05T00:00:00.000Z", price: 2, storeName: "Lidl" },
        ]}
        showStores
      />,
    );

    // A store seen once has no line — a line needs two points — so the dot
    // *is* the series. At r=4 it read as a speck of grid, which is how three
    // stores in the legend became one visible line.
    const dot = lineProps[0]?.dot as { r?: number } | undefined;
    expect(dot?.r ?? 0).toBeGreaterThanOrEqual(5);
    const active = lineProps[0]?.activeDot as { r?: number } | undefined;
    expect(active?.r ?? 0).toBeGreaterThanOrEqual(8);
  });

  it("takes its series colours from tokens, so night is a choice not a flip", () => {
    renderWithIntl(<PriceChart data={data} showStores />);

    // They used to be fixed hexes shared by both themes, so an orange picked
    // for a white card sat on a near-black one at night.
    for (const line of lineProps) {
      expect(String(line.stroke)).toMatch(/^var\(--series-\d\)$/);
    }
  });

  it("never cycles a hue: the fifth store is dropped and said so", async () => {
    const many = ["A", "B", "C", "D", "E"].map((storeName, index) => ({
      date: `2026-01-0${index + 1}T00:00:00.000Z`,
      price: 1 + index,
      storeName,
    }));
    renderWithIntl(<PriceChart data={many} showStores />);

    // A fifth slot would reuse a hue and be indistinguishable from an
    // existing one under colour vision deficiency.
    expect(lineProps).toHaveLength(4);
    expect(screen.getByText(/Otras 1 tienda/)).toBeInTheDocument();
  });

  it("offers the values as a table, which is what makes the chart optional", async () => {
    renderWithIntl(<PriceChart data={data} showStores />);

    await userEvent.click(screen.getByRole("button", { name: "Ver como tabla" }));

    // axe cannot read an SVG, and two of the four series sit below 3:1 on the
    // light card. The table is what makes both acceptable.
    const table = screen.getByRole("table");
    expect(table).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader").length).toBeGreaterThan(1);
  });

  it("draws a solid grid, not a dashed one", () => {
    renderWithIntl(<PriceChart data={data} />);

    // Dashing reads as a projection or a threshold when it is only a grid.
    expect(gridProps?.strokeDasharray).toBeUndefined();
  });
});
