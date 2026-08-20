"use client";

import { useLocale, useTranslations } from "next-intl";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";
import { api } from "@/lib/trpc/client";

interface BestPriceIndicatorProps {
  productId: string;
  currentPrice?: number;
  currentStoreId?: string;
}

export function BestPriceIndicator({
  productId,
  currentPrice,
  currentStoreId,
}: BestPriceIndicatorProps) {
  const t = useTranslations("prices");
  const locale = useLocale();
  const { data: prices, isLoading } = api.price.getLatestPrices.useQuery({
    productId,
  });

  if (isLoading || !prices || prices.length === 0) {
    return null;
  }

  const sortedPrices = [...prices].sort((a, b) => a.price - b.price);
  const bestPrice = sortedPrices[0];

  // If current price is provided, compare it
  if (currentPrice !== undefined && currentStoreId) {
    const isBestPrice = currentPrice <= bestPrice.price + 0.01; // Small tolerance
    const isGoodDeal = currentPrice <= bestPrice.price * 1.1; // Within 10%

    if (isBestPrice) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-ok px-2 py-1 text-xs font-medium text-ok-foreground">
          <svg
            className="h-3 w-3"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <title>{t("bestPrice")}</title>
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          {t("bestPrice")}
        </span>
      );
    }

    if (isGoodDeal) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
          {t("priceStable")}
        </span>
      );
    }

    const priceDiff = ((currentPrice / bestPrice.price - 1) * 100).toFixed(0);
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warn px-2 py-1 text-xs font-medium text-warn-foreground">
        +{priceDiff}%
      </span>
    );
  }

  // Show best price badge
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{t("bestPrice")}:</span>
      <span className="font-medium text-ok-foreground">
        {formatMoney(locale, bestPrice.price, bestPrice.currency ?? DEFAULT_CURRENCY)}
      </span>
      <span className="text-sm text-muted-foreground">{t("atStore", { store: bestPrice.store.name })}</span>
    </div>
  );
}
