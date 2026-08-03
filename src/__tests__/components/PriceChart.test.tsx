import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup } from "@testing-library/react";
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
let lineProps: Array<{ dataKey: string; stroke: string }> = [];
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
  Line: (props: { dataKey: string; stroke: string }) => {
    lineProps.push(props);
    return null;
  },
  XAxis: () => null,
  YAxis: (props: { tickFormatter?: (value: number) => string }) => {
    yTickFormatter = props.tickFormatter;
    return null;
  },
  CartesianGrid: () => null,
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

  it("labels records with no store as Unknown", () => {
    renderWithIntl(
      <PriceChart
        data={[{ date: "2026-01-05T00:00:00.000Z", price: 2 }]}
        showStores
      />,
    );

    expect(lineProps.map((line) => line.dataKey)).toEqual(["Unknown"]);
  });

  it("only shows the legend in store-comparison mode", () => {
    renderWithIntl(<PriceChart data={data} />);
    expect(legendRendered).toBe(false);

    cleanup();
    renderWithIntl(<PriceChart data={data} showStores />);
    expect(legendRendered).toBe(true);
  });

  it("formats the price axis in euros", () => {
    renderWithIntl(<PriceChart data={data} />);

    expect(yTickFormatter?.(1.5)).toBe("€1.50");
  });

  it("renders an empty chart without crashing", () => {
    renderWithIntl(<PriceChart data={[]} />);

    expect(chartData).toEqual([]);
    expect(lineProps).toHaveLength(1);
  });
});
