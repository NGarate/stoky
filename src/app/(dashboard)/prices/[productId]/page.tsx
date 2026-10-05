"use client";

import React, { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { BackLink } from "@/components/ui/back-link";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import { PriceChart } from "@/components/price/PriceChart";
import { StoreComparison } from "@/components/price/StoreComparison";
import { toChartPoints } from "@/lib/prices/unitPrice";

interface ProductPricePageProps {
  params: Promise<{ productId: string }>;
}

export default function ProductPricePage({ params }: ProductPricePageProps) {
  const t = useTranslations();
  const [days, setDays] = useState(90);
  const { productId } = React.use(params);

  // The previous range stays up while a new one is asked, so changing it
  // does not swap the page — and the control just used — for a loading state.
  const query = api.price.getHistory.useQuery(
    { productId, days },
    { placeholderData: keepPreviousData },
  );
  const history = query.data;

  // `!data` rather than `isLoading`, which is false for a query that is
  // paused offline or has failed — so with no signal, or after a 500, this
  // fell straight through to the empty state and told somebody they had
  // nothing. RouteState says which of loading, offline or failed it is.
  if (!history) {
    return (
      <RouteState
        error={query.error}
        fetchStatus={query.fetchStatus}
        isLoading={query.isPending}
        onRetry={() => void query.refetch()}
        title={t("prices.history")}
      />
    );
  }

  // Unit prices, so a week the household bought the six-pack is not drawn
  // as a price spike.
  const chartData = toChartPoints(history);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <BackLink href="/prices">{t("common.back")}</BackLink>
        <h1 className="mt-2 text-2xl font-bold text-heading md:text-4xl">
          {t("prices.history")}
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label htmlFor="days-select" className="text-sm font-medium md:text-lg">{t("common.date")}:</label>
        <Select
          id="days-select"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={30}>30 {t("common.days")}</option>
          <option value={90}>90 {t("common.days")}</option>
          <option value={180}>6 {t("common.months")}</option>
          <option value={365}>1 {t("common.year")}</option>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm md:p-6">
        <h2 className="mb-4 text-lg font-semibold text-heading">{t("prices.chart.title")}</h2>
        {chartData.length > 0 ? (
          <PriceChart data={chartData} />
        ) : (
          <p className="py-8 text-center text-muted-foreground">{t("prices.noPrices")}</p>
        )}
      </div>

      <StoreComparison productId={productId} />
    </div>
  );
}
