"use client";

import { useLocale, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { useQuantityFormat } from "@/lib/inventory/quantity";
import { DEFAULT_CURRENCY, formatMoney, formatUnitPrice } from "@/lib/money";
import { api } from "@/lib/trpc/client";
import { sectionHeading } from "@/components/ui/section";

import type { JSX } from "react";
import { formatDate } from "@/lib/dates";

/**
 * Where this product is cheapest.
 *
 * It used to answer that question three times over: a row of best/average/
 * worst tiles, then a card list of every store, then — from `lg` — a table of
 * the same stores again. Three renderings of one small set, and the answer
 * ("Mercadona") was in all of them and emphasised by none.
 *
 * It is now one sorted bar per store, cheapest first, with the cheapest in the
 * accent and every other in the de-emphasis grey. That is the emphasis
 * pattern rather than a categorical palette: the story is *one* of these, not
 * "tell the stores apart", and a hue per store would spend the only free
 * channel on identity the labels already carry.
 *
 * **Bars in HTML, not a chart library.** Every value is rendered as text
 * beside its bar, so the bar adds the comparison and removes nothing: there is
 * no separate "table view" to build because the markup is already the table
 * view. It also means axe can read it, it survives with no JavaScript, and it
 * needs no ResizeObserver — none of which is true of a canvas.
 *
 * **The scale starts at zero**, so a 1,19 € bar and a 1,35 € bar look nearly
 * the same length. That is the honest picture: they *are* nearly the same
 * price. The percentage beside each carries the fine distinction, which is the
 * part a truncated axis would exaggerate into a story that is not there.
 *
 * **Ranked by unit price.** A record's `price` is what was paid for
 * `quantity` units, so a six-pack at 5,34 € beside one carton at 0,99 € used
 * to come out as the single being best and the pack 439 % dearer. Every
 * figure here — order, bars, average, premium — is `unitPrice`, which the
 * server computes once; the total paid is shown beside it when it differs.
 */
export function StoreComparison({
  productId,
}: {
  productId: string;
}): JSX.Element {
  const t = useTranslations();
  const units = useQuantityFormat();
  const locale = useLocale();
  const { data: prices, isLoading } = api.price.getLatestPrices.useQuery({
    productId,
  });

  if (isLoading) {
    return <div className="p-4">{t("common.loading")}</div>;
  }

  if (!prices || prices.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-center text-muted-foreground">
        {t("prices.noPrices")}
      </div>
    );
  }

  const sorted = [...prices].sort((a, b) => a.unitPrice - b.unitPrice);
  const best = sorted[0]!;
  const dearest = sorted[sorted.length - 1]!;
  const average =
    sorted.reduce((sum, price) => sum + price.unitPrice, 0) / sorted.length;

  // Derived from these rows rather than being one, so it takes the cheapest
  // row's currency. A comparison mixing currencies is already meaningless; an
  // average across two of them doubly so.
  const currency = best.currency ?? DEFAULT_CURRENCY;

  /** Whole percent over the cheapest. Zero for the cheapest itself. */
  const premium = (price: number): number =>
    Math.round((price / best.unitPrice - 1) * 100);

  return (
    <section
      aria-labelledby="store-comparison"
      className="rounded-lg border border-border bg-card p-4"
    >
      {/* An h2, in the section size. It was an h3 at md:text-2xl directly
          after the chart's h2 at text-lg: the outline said "part of the
          chart" while the type said "more important than it" (WCAG 1.3.1).
          It is a sibling section of the page, so it is the same level and
          the same size. */}
      <h2 className={sectionHeading()} id="store-comparison">
        {t("prices.comparison")}
      </h2>
      <p className="mt-1 text-muted-foreground">
        {t("prices.comparisonSummary", {
          average: formatUnitPrice(locale, average, currency),
          count: sorted.length,
        })}
      </p>

      <ul className="mt-4 space-y-4">
        {sorted.map((price, index) => {
          const isBest = index === 0;
          const over = premium(price.unitPrice);
          const priceCurrency = price.currency ?? DEFAULT_CURRENCY;

          return (
            <li key={price.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span
                  className={
                    isBest
                      ? "font-semibold text-foreground md:text-lg"
                      : "text-foreground md:text-lg"
                  }
                >
                  {price.store.name}
                </span>
                <span
                  className={
                    isBest
                      ? "font-bold text-heading text-lg md:text-xl"
                      : "font-medium text-foreground md:text-lg"
                  }
                >
                  {formatUnitPrice(locale, price.unitPrice, priceCurrency)}{" "}
                  {t("prices.perUnit", { unit: units.unit(price.unit, 1) })}
                </span>
              </div>

              {/* The bar is decoration over a number that is already written
                  above it, so it is hidden from assistive technology rather
                  than announced as a second, wordless copy. */}
              <span
                aria-hidden="true"
                className="mt-1 block h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <span
                  className={`block h-2 rounded-full ${
                    isBest ? "bg-chart-emphasis" : "bg-chart-muted"
                  }`}
                  style={{
                    width: `${(price.unitPrice / dearest.unitPrice) * 100}%`,
                  }}
                />
              </span>

              <p className="mt-1 text-sm text-muted-foreground md:text-base">
                {/* `neutral`: the cheapest shop is a ranking, not a state,
                    and `ok` has to keep meaning "this is fine". */}
                {isBest ? (
                  <Badge tone="neutral">{t("prices.bestPrice")}</Badge>
                ) : (
                  <span>
                    {t("prices.premiumOver", { percent: `${over}%` })}
                  </span>
                )}
                {price.quantity === 1 ? null : (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">. </span>
                    {t("prices.paidFor", {
                      total: formatMoney(locale, price.price, priceCurrency),
                      quantity: price.quantity,
                      unit: units.unit(price.unit, price.quantity),
                    })}
                  </>
                )}
                <span aria-hidden="true"> · </span>
                <span className="sr-only">. </span>
                {t("prices.recordedOn", {
                  date: formatDate(locale, price.recordedAt, "short"),
                })}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
