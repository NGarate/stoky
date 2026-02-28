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
      <div className="rounded-lg border bg-white p-4 text-center text-gray-500">
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
    <div className="rounded-lg border bg-white p-4">
      <h3 className="mb-4 text-lg font-semibold">{t("prices.comparison")}</h3>

      <div className="mb-4 grid grid-cols-3 gap-4">
        <div className="rounded-md bg-green-50 p-3">
          <p className="text-sm text-green-600">{t("prices.bestPrice")}</p>
          <p className="text-2xl font-bold text-green-700">
            €{bestPrice.price.toFixed(2)}
          </p>
          <p className="text-xs text-green-600">{bestPrice.store.name}</p>
        </div>
        <div className="rounded-md bg-blue-50 p-3">
          <p className="text-sm text-blue-600">{t("prices.averagePrice")}</p>
          <p className="text-2xl font-bold text-blue-700">
            €{avgPrice.toFixed(2)}
          </p>
        </div>
        <div className="rounded-md bg-red-50 p-3">
          <p className="text-sm text-red-600">{t("prices.worstPrice")}</p>
          <p className="text-2xl font-bold text-red-700">
            €{worstPrice.price.toFixed(2)}
          </p>
          <p className="text-xs text-red-600">{worstPrice.store.name}</p>
        </div>
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className="pb-2 text-left text-sm font-medium text-gray-500">
              {t("stores.name")}
            </th>
            <th className="pb-2 text-right text-sm font-medium text-gray-500">
              {t("common.price")}
            </th>
            <th className="pb-2 text-right text-sm font-medium text-gray-500">
              {t("common.date")}
            </th>
            <th className="pb-2 text-right text-sm font-medium text-gray-500">
              {t("prices.priceChange")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedPrices.map((price, index) => (
            <tr key={price.id} className="border-b last:border-0">
              <td className="py-3">
                <div className="flex items-center gap-2">
                  {index === 0 && (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      {t("prices.bestPrice")}
                    </span>
                  )}
                  {price.store.name}
                </div>
              </td>
              <td className="py-3 text-right font-medium">
                €{price.price.toFixed(2)}
              </td>
              <td className="py-3 text-right text-sm text-gray-500">
                {new Date(price.recordedAt).toLocaleDateString()}
              </td>
              <td className="py-3 text-right">
                {index > 0 ? (
                  <span
                    className={`text-sm ${
                      price.price < sortedPrices[0].price * 1.1
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {((price.price / sortedPrices[0].price - 1) * 100).toFixed(
                      0
                    )}
                    %
                  </span>
                ) : (
                  <span className="text-sm text-gray-400">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
