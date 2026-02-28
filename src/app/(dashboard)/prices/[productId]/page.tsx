"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { PriceChart } from "@/components/price/PriceChart";
import { StoreComparison } from "@/components/price/StoreComparison";

interface ProductPricePageProps {
  params: Promise<{ productId: string }>;
}

export default function ProductPricePage({ params }: ProductPricePageProps) {
  const t = useTranslations();
  const [days, setDays] = useState(90);
  const { productId } = React.use(params);

  const { data: history, isLoading } = api.price.getHistory.useQuery({
    productId,
    days,
  });

  const { data: trends } = api.price.getPriceTrends.useQuery({
    productId,
    days,
  });

  if (isLoading) {
    return <div className="p-8">{t("common.loading")}</div>;
  }

  const chartData =
    history?.map((record) => ({
      date: record.recordedAt.toISOString(),
      price: record.price,
      storeName: record.store.name,
    })) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/prices"
          className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
        >
          {t("common.back")}
        </Link>
        <h1 className="text-2xl font-bold">{t("prices.history")}</h1>
      </div>

      <div className="flex items-center gap-4">
        <label htmlFor="days-select" className="text-sm font-medium">{t("common.date")}:</label>
        <select
          id="days-select"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-3 py-1"
        >
          <option value={30}>30 {t("common.days")}</option>
          <option value={90}>90 {t("common.days")}</option>
          <option value={180}>6 {t("common.months")}</option>
          <option value={365}>1 {t("common.year")}</option>
        </select>
      </div>

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">{t("prices.chart.title")}</h2>
        {chartData.length > 0 ? (
          <PriceChart data={chartData} showStores={true} />
        ) : (
          <p className="py-8 text-center text-gray-500">{t("prices.noPrices")}</p>
        )}
      </div>

      <StoreComparison productId={productId} />

      {trends && trends.length > 0 && (
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">{t("prices.trends")}</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="pb-2 text-left">{t("common.date")}</th>
                <th className="pb-2 text-right">{t("prices.averagePrice")}</th>
                <th className="pb-2 text-right">{t("prices.bestPrice")}</th>
                <th className="pb-2 text-right">{t("prices.worstPrice")}</th>
              </tr>
            </thead>
            <tbody>
              {trends.map((trend) => (
                <tr key={trend.date} className="border-b last:border-0">
                  <td className="py-3">
                    {new Date(trend.date).toLocaleDateString()}
                  </td>
                  <td className="py-3 text-right">
                    €{trend.averagePrice.toFixed(2)}
                  </td>
                  <td className="py-3 text-right text-green-600">
                    €{trend.minPrice.toFixed(2)}
                  </td>
                  <td className="py-3 text-right text-red-600">
                    €{trend.maxPrice.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
