"use client";

import { useLocale, useTranslations } from "next-intl";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";
import { api } from "@/lib/trpc/client";

interface StoreComparisonProps {
  productId: string;
}

export function StoreComparison({ productId }: StoreComparisonProps) {
  const t = useTranslations();
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

  // Sort by price
  const sortedPrices = [...prices].sort((a, b) => a.price - b.price);
  const bestPrice = sortedPrices[0];
  const worstPrice = sortedPrices[sortedPrices.length - 1];
  const avgPrice =
    sortedPrices.reduce((sum, p) => sum + p.price, 0) / sortedPrices.length;
  // The three figures above the list are derived from these rows rather than
  // being rows themselves, so they take the cheapest row's currency. Mixing
  // currencies in one comparison is already meaningless — an average across
  // two of them doubly so — and this at least labels the result honestly.
  const currency = bestPrice.currency ?? DEFAULT_CURRENCY;

  /** The premium over the cheapest store, as a whole percentage. */
  const premium = (price: number): string =>
    `${((price / sortedPrices[0].price - 1) * 100).toFixed(0)}%`;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-4 text-lg font-semibold text-heading md:text-2xl">{t("prices.comparison")}</h3>

      {/* Three figures side by side needs 390px it does not have; they stack on
          the phone and go back to a row from `md`. */}
      <div className="mb-4 grid gap-3 md:grid-cols-3 md:gap-4">
        <div className="rounded-md bg-ok p-3">
          <p className="text-sm text-ok-foreground">{t("prices.bestPrice")}</p>
          <p className="text-2xl font-bold text-ok-foreground">
            {formatMoney(locale, bestPrice.price, currency)}
          </p>
          <p className="text-xs text-ok-foreground">{bestPrice.store.name}</p>
        </div>
        <div className="rounded-md bg-muted p-3">
          <p className="text-sm text-muted-foreground">{t("prices.averagePrice")}</p>
          <p className="text-2xl font-bold text-foreground">
            {formatMoney(locale, avgPrice, currency)}
          </p>
        </div>
        <div className="rounded-md bg-danger p-3">
          <p className="text-sm text-danger-foreground">{t("prices.worstPrice")}</p>
          <p className="text-2xl font-bold text-danger-foreground">
            {formatMoney(locale, worstPrice.price, currency)}
          </p>
          <p className="text-xs text-danger-foreground">{worstPrice.store.name}</p>
        </div>
      </div>

      {/* Phone and tablet: one card per store, cheapest first. All four columns
          survive — store, price, date and the premium over the cheapest
          (DESIGN_AUDIT A3.2). */}
      <ul className="space-y-3 lg:hidden">
        {sortedPrices.map((price, index) => (
          <li
            key={price.id}
            className="rounded-md border border-border p-3 md:p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-foreground md:text-xl">
                {price.store.name}
              </span>
              <span className="text-lg font-semibold text-heading md:text-2xl">
                {formatMoney(locale, price.price, price.currency ?? DEFAULT_CURRENCY)}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground md:text-lg">
              {new Date(price.recordedAt).toLocaleDateString()}
            </p>
            <p className="mt-1 text-sm md:text-lg">
              <span className="text-muted-foreground">
                {t("prices.priceChange")}:{" "}
              </span>
              {index === 0 ? (
                <span className="font-medium text-ok-foreground">
                  {t("prices.bestPrice")}
                </span>
              ) : (
                <span
                  className={`font-medium ${
                    price.price < sortedPrices[0].price * 1.1
                      ? "text-ok-foreground"
                      : "text-danger-foreground"
                  }`}
                >
                  {premium(price.price)}
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>

      <table className="hidden w-full lg:table">
        <thead>
          <tr className="border-b border-border">
            <th className="pb-2 text-left text-sm font-medium text-muted-foreground">
              {t("stores.name")}
            </th>
            <th className="pb-2 text-right text-sm font-medium text-muted-foreground">
              {t("common.price")}
            </th>
            <th className="pb-2 text-right text-sm font-medium text-muted-foreground">
              {t("common.date")}
            </th>
            <th className="pb-2 text-right text-sm font-medium text-muted-foreground">
              {t("prices.priceChange")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedPrices.map((price, index) => (
            <tr key={price.id} className="border-b border-border last:border-0">
              <td className="py-3">
                <div className="flex items-center gap-2">
                  {index === 0 && (
                    <span className="rounded bg-ok px-2 py-0.5 text-xs font-medium text-ok-foreground">
                      {t("prices.bestPrice")}
                    </span>
                  )}
                  {price.store.name}
                </div>
              </td>
              <td className="py-3 text-right font-medium">
                {formatMoney(locale, price.price, price.currency ?? DEFAULT_CURRENCY)}
              </td>
              <td className="py-3 text-right text-sm text-muted-foreground">
                {new Date(price.recordedAt).toLocaleDateString()}
              </td>
              <td className="py-3 text-right">
                {index > 0 ? (
                  <span
                    className={`text-sm ${
                      price.price < sortedPrices[0].price * 1.1
                        ? "text-ok-foreground"
                        : "text-danger-foreground"
                    }`}
                  >
                    {premium(price.price)}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
