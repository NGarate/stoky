"use client";

import React, { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";
import { api } from "@/lib/trpc/client";
import { PriceChart } from "@/components/price/PriceChart";
import { StoreComparison } from "@/components/price/StoreComparison";

interface ProductPricePageProps {
  params: Promise<{ productId: string }>;
}

export default function ProductPricePage({ params }: ProductPricePageProps) {
  const t = useTranslations();
  const locale = useLocale();
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
      <div className="flex flex-wrap items-center gap-4">
        <Button asChild className="md:text-lg" variant="outline">
          <Link href="/prices" > {t("common.back")} </Link>
        </Button>
        <h1 className="text-2xl font-bold text-heading md:text-4xl">{t("prices.history")}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label htmlFor="days-select" className="text-sm font-medium md:text-lg">{t("common.date")}:</label>
        <select
          id="days-select"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="min-h-[48px] rounded-md border border-input bg-card px-3 py-1 text-foreground md:text-lg"
        >
          <option value={30}>30 {t("common.days")}</option>
          <option value={90}>90 {t("common.days")}</option>
          <option value={180}>6 {t("common.months")}</option>
          <option value={365}>1 {t("common.year")}</option>
        </select>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm md:p-6">
        <h2 className="mb-4 text-lg font-semibold text-heading">{t("prices.chart.title")}</h2>
        {chartData.length > 0 ? (
          <PriceChart data={chartData} showStores={true} />
        ) : (
          <p className="py-8 text-center text-muted-foreground">{t("prices.noPrices")}</p>
        )}
      </div>

      <StoreComparison productId={productId} />

      {trends && trends.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm md:p-6">
          <h2 className="mb-4 text-lg font-semibold text-heading md:text-2xl">{t("prices.trends")}</h2>

          {/* Phone and tablet: one card per day. All four columns survive —
              date, average, best and worst (DESIGN_AUDIT A3.2). */}
          <ul className="space-y-3 lg:hidden">
            {trends.map((trend) => (
              <li
                key={trend.date}
                className="rounded-md border border-border p-3 md:p-4"
              >
                <p className="font-medium text-foreground md:text-xl">
                  {new Date(trend.date).toLocaleDateString()}
                </p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm md:text-lg">
                  <div>
                    <dt className="text-muted-foreground">
                      {t("prices.averagePrice")}
                    </dt>
                    <dd className="mt-1 font-medium text-foreground">
                      {formatMoney(locale, trend.averagePrice, DEFAULT_CURRENCY)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t("prices.bestPrice")}
                    </dt>
                    <dd className="mt-1 font-medium text-ok-foreground">
                      {formatMoney(locale, trend.minPrice, DEFAULT_CURRENCY)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t("prices.worstPrice")}
                    </dt>
                    <dd className="mt-1 font-medium text-danger-foreground">
                      {formatMoney(locale, trend.maxPrice, DEFAULT_CURRENCY)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>

          <table className="hidden w-full lg:table">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-2 text-left">{t("common.date")}</th>
                <th className="pb-2 text-right">{t("prices.averagePrice")}</th>
                <th className="pb-2 text-right">{t("prices.bestPrice")}</th>
                <th className="pb-2 text-right">{t("prices.worstPrice")}</th>
              </tr>
            </thead>
            <tbody>
              {trends.map((trend) => (
                <tr key={trend.date} className="border-b border-border last:border-0">
                  <td className="py-3">
                    {new Date(trend.date).toLocaleDateString()}
                  </td>
                  <td className="py-3 text-right">
                    {formatMoney(locale, trend.averagePrice, DEFAULT_CURRENCY)}
                  </td>
                  <td className="py-3 text-right text-ok-foreground">
                    {formatMoney(locale, trend.minPrice, DEFAULT_CURRENCY)}
                  </td>
                  <td className="py-3 text-right text-danger-foreground">
                    {formatMoney(locale, trend.maxPrice, DEFAULT_CURRENCY)}
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
