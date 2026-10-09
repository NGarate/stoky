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
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { CHART_TOOLTIP } from "@/lib/chart-tooltip";
import { DEFAULT_CURRENCY, formatUnitPrice } from "@/lib/money";

import type { JSX } from "react";
import { formatDate } from "@/lib/dates";

interface PriceDataPoint {
  date: string;
  /** Per unit (`toChartPoints`), never a record's total paid. */
  price: number;
  storeName?: string;
}

/**
 * How the price has moved.
 *
 * Four things were wrong with it, and the seeded data showed all four at
 * once: three stores in the legend and one visible line.
 *
 * - **Markers were 8px and easy to miss.** A store with a single observation
 *   has no line at all — a line needs two points — so its dot *is* the
 *   series, and at r=4 it read as a speck of grid. They are bigger now, and
 *   the hover target bigger still.
 * - **The palette had never been validated.** It opened with `--gauge`,
 *   which is outside the lightness band and below the chroma floor for a
 *   categorical slot: next to the others it reads as grey rather than as a
 *   colour. The four slots are now `--series-1` … `--series-4`, stepped per
 *   theme — the old set was five fixed hexes shared by light and dark, so
 *   `#c2410c` sat on a near-black card at night.
 * - **The grid was dashed**, which reads as a projection or a threshold when
 *   it is only a grid. It is a solid hairline.
 * - **There was no way to read it without seeing it.** axe cannot read an
 *   SVG, and two of the four series sit below 3:1 on the light card. The
 *   table view is what makes that legal *and* what makes the chart optional.
 *
 * Colour is never the only carrier: a legend is always present for two or
 * more series, and the table view names every store beside every price.
 *
 * **Words are ink, colour is a swatch.** Recharts' own legend and tooltip
 * paint each store's *name* in that store's series colour, which on the light
 * card measured 2.17–4.42:1 — under AA, let alone the 7:1 this application
 * holds text to. The series hues are audited for telling series apart, not
 * for being read (see the note beside PAIRS in `check-contrast.ts`), so they
 * are kept off every glyph: the legend is ours, in `foreground`, with the hue
 * in a swatch beside the name, and the tooltip names each store in
 * `foreground` too — where it used to label every row "Precio por unidad",
 * leaving the colour alone to say which shop a price was.
 */
export function PriceChart({
  data,
}: {
  data: PriceDataPoint[];
}): JSX.Element {
  const t = useTranslations("prices.chart");
  const locale = useLocale();
  const [asTable, setAsTable] = useState(false);

  const money = (value: number): string =>
    formatUnitPrice(locale, value, DEFAULT_CURRENCY);

  // `PriceRecord.storeId` is required, so this should never be reached
  // through the real query — but the prop is optional and the fallback used
  // to be the literal string "Unknown", which is an English word in a Spanish
  // application and a legend entry nobody could act on.
  const unknownStore = t("unknownStore");

  type ChartDataPoint = { date: string; [key: string]: string | number };

  const chartData: ChartDataPoint[] = Object.values(
    data.reduce((acc: Record<string, ChartDataPoint>, item) => {
      const date = formatDate(locale, item.date, "short");
      // `??=` rather than this reads better and the React Compiler does not
      // support it — it declines to optimise the whole component and
      // `bun run check:react` fails on the syntax.
      if (!acc[date]) acc[date] = { date };
      acc[date][item.storeName ?? unknownStore] = item.price;
      return acc;
    }, {}),
  );

  /**
   * Four slots, never cycled.
   *
   * A fifth series would reuse a hue and become indistinguishable from an
   * existing one, so the tail is dropped from the chart rather than coloured
   * twice — and the table view, which has no such limit, still carries it.
   * A household with five shops for one product is not the case this screen
   * is for.
   */
  const SERIES_LIMIT = 4;
  const allStores = [
    ...new Set(data.map((item) => item.storeName ?? unknownStore)),
  ];
  const storeNames = allStores.slice(0, SERIES_LIMIT);
  const hiddenStores = allStores.length - storeNames.length;

  const colours = [
    "var(--series-1)",
    "var(--series-2)",
    "var(--series-3)",
    "var(--series-4)",
  ];

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Button
          onClick={() => setAsTable((current) => !current)}
          size="sm"
          type="button"
          variant="outline"
        >
          {asTable ? t("chartView") : t("tableView")}
        </Button>
      </div>

      {asTable ? (
        <PriceTable
          data={chartData}
          money={money}
          series={allStores}
          dateLabel={t("xAxis")}
        />
      ) : (
        <>
          <div className="h-80 w-full">
            <ResponsiveContainer height="100%" width="100%">
              <LineChart data={chartData}>
                {/* Solid, one shade off the surface. Dashing reads as a
                    projection or a threshold when it is only a grid. */}
                <CartesianGrid stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  stroke="var(--border)"
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  stroke="var(--border)"
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  tickFormatter={money}
                />
                <Tooltip
                  {...CHART_TOOLTIP}
                  formatter={(value: number, name: string) => [money(value), name]}
                  labelFormatter={(label) => label}
                />
                {storeNames.map((storeName, index) => (
                    <Line
                      activeDot={{ r: 8 }}
                      // A store seen once has no line — a line needs two
                      // points — so the marker is the whole series. Its path
                      // is `M271,37Z`, which draws nothing.
                      dot={{ r: 5 }}
                      dataKey={storeName}
                      // Recharts holds every dot back until its line has
                      // finished animating, so a single-observation series
                      // was invisible for the first 1.5 seconds and — since
                      // its line is a degenerate path — invisible after that
                      // too. Measured: zero `<circle>` elements in the SVG.
                      //
                      // Turning the animation off is the fix and is right on
                      // its own terms: `globals.css` suppresses motion under
                      // `prefers-reduced-motion`, but it can only reach CSS,
                      // and this animation is JavaScript. A price line is
                      // read, not watched.
                      isAnimationActive={false}
                      // Rows are one per *date*, and a store only has a value
                      // on the dates it was seen. So a shop recorded in
                      // January and March had `undefined` on every row
                      // belonging to some other shop in between, and Recharts
                      // read each of those as the end of the line — two lone
                      // points and no line at all, on the screen whose whole
                      // job is comparing shops over time.
                      //
                      // Joining across them is also the honest reading: a
                      // price series between two observations means "it went
                      // from here to there", not "this shop ceased to exist
                      // on the days a different shop was visited".
                      connectNulls
                      key={storeName}
                      stroke={colours[index]}
                      strokeWidth={2}
                      type="monotone"
                    />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {storeNames.length > 1 ? (
            <ul aria-label={t("legend")} className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {storeNames.map((storeName, index) => (
                <li className="flex items-center gap-2 text-sm text-foreground" key={storeName}>
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: colours[index] }}
                  />
                  {storeName}
                </li>
              ))}
            </ul>
          ) : null}

          {hiddenStores > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("otherStores", { count: hiddenStores })}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The chart's values, for anything that cannot read a canvas. */
function PriceTable({
  data,
  series,
  money,
  dateLabel,
}: {
  data: Array<{ date: string; [key: string]: string | number }>;
  series: string[];
  money: (value: number) => string;
  dateLabel: string;
}): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="pb-2 text-left font-medium text-muted-foreground">
              {dateLabel}
            </th>
            {series.map((name) => (
              <th
                className="pb-2 text-right font-medium text-muted-foreground"
                key={name}
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Keyed by the date, which is unique: the rows are one per date
              by construction, grouped in `chartData` above. This carried the
              index as well, guarding against two prices on one day — the
              case a receipt with two lines for the same product produced in
              the per-record view that used to exist. It does not any more,
              so neither does the collision. */}
          {data.map((row) => (
            <tr className="border-border border-b last:border-0" key={row.date}>
              <td className="py-2">{row.date}</td>
              {series.map((name) => (
                <td className="py-2 text-right tabular-nums" key={name}>
                  {typeof row[name] === "number" ? money(row[name]) : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
