"use client";

import { useTranslations } from "next-intl";
import { api } from "@/lib/trpc/client";

interface StoreComparisonProps {
  productId: string;
}

export function StoreComparison({ productId }: StoreComparisonProps) {
  const t = useTranslations();
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

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-4 text-lg font-semibold text-heading">{t("prices.comparison")}</h3>

      <div className="mb-4 grid grid-cols-3 gap-4">
        <div className="rounded-md bg-ok p-3">
          <p className="text-sm text-ok-foreground">{t("prices.bestPrice")}</p>
          <p className="text-2xl font-bold text-ok-foreground">
            €{bestPrice.price.toFixed(2)}
          </p>
          <p className="text-xs text-ok-foreground">{bestPrice.store.name}</p>
        </div>
        <div className="rounded-md bg-muted p-3">
          <p className="text-sm text-muted-foreground">{t("prices.averagePrice")}</p>
          <p className="text-2xl font-bold text-foreground">
            €{avgPrice.toFixed(2)}
          </p>
        </div>
        <div className="rounded-md bg-danger p-3">
          <p className="text-sm text-danger-foreground">{t("prices.worstPrice")}</p>
          <p className="text-2xl font-bold text-danger-foreground">
            €{worstPrice.price.toFixed(2)}
          </p>
          <p className="text-xs text-danger-foreground">{worstPrice.store.name}</p>
        </div>
      </div>

      <table className="w-full">
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
                €{price.price.toFixed(2)}
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
                    {((price.price / sortedPrices[0].price - 1) * 100).toFixed(
                      0
                    )}
                    %
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
