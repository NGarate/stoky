"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocale, useTranslations } from "next-intl";
import { CHART_TOOLTIP } from "@/lib/chart-tooltip";
import { useQuantityFormat } from "@/lib/inventory/quantity";
import { formatDate } from "@/lib/dates";

/**
 * Net stock over time — the history screen's chart (Phase 8 item 5).
 *
 * One series, the gauge token, mirroring `PriceChart`: the design system has
 * no categorical scale and a single product's ledger needs none. The points
 * arrive already carrying their running total (`runningTotals`), oldest first,
 * so this component only formats — arithmetic lives in the pure module the
 * unit suite holds.
 */
export interface StockChartPoint {
  /** ISO date of the movement. */
  date: string;
  /** Net stock immediately after it. */
  total: number;
}

export function StockHistoryChart({
  points,
  unit,
}: {
  points: StockChartPoint[];
  unit: string;
}) {
  const t = useTranslations("products.history");
  const units = useQuantityFormat();
  const locale = useLocale();

  const chartData = points.map((point) => ({
    date: formatDate(locale, point.date, "short"),
    total: point.total,
  }));

  return (
    <div aria-hidden="true" className="h-72 w-full">
      {/* aria-hidden: the ledger table below carries the same information row
          by row — a reader gets the numbers, not a shape it cannot see.
          accessibilityLayer off for the same reason: Recharts 3 makes the
          chart a tab stop by default, and a tab stop inside aria-hidden is
          focus landing on something no screen reader can announce. */}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart accessibilityLayer={false} data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            stroke="var(--border)"
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            stroke="var(--border)"
            allowDecimals={false}
          />
          <Tooltip
            {...CHART_TOOLTIP}
            formatter={(value) => [
              units.quantity(Number(value), unit),
              t("totalHeader"),
            ]}
            labelFormatter={(label) => label}
          />
          <Line
            type="stepAfter"
            dataKey="total"
            stroke="var(--gauge)"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
