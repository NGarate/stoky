"use client";

import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { DEFAULT_CURRENCY, formatUnitPrice } from "@/lib/money";
import { api } from "@/lib/trpc/client";
import { useQuantityFormat } from "@/lib/inventory/quantity";
import { Decimal } from "@prisma/client-runtime-utils";

interface BestPriceIndicatorProps {
  productId: string;
  /** Per unit, like everything this compares against — not a total paid. */
  currentPrice?: number;
  currentStoreId?: string;
}

export function BestPriceIndicator({
  productId,
  currentPrice,
  currentStoreId,
}: BestPriceIndicatorProps) {
  const t = useTranslations("prices");
  const units = useQuantityFormat();
  const locale = useLocale();
  const { data: prices, isLoading } = api.price.getLatestPrices.useQuery({
    productId,
  });

  if (isLoading || !prices || prices.length === 0) {
    return null;
  }

  // By unit price: `price` is the total paid for `quantity` units, so a
  // six-pack ranked by it lost to a single carton (see StoreComparison).
  const sortedPrices = [...prices].sort((a, b) =>
    a.unitPrice.comparedTo(b.unitPrice),
  );
  const bestPrice = sortedPrices[0]!;

  // If current price is provided, compare it
  if (currentPrice !== undefined && currentStoreId) {
    const isBestPrice = bestPrice.unitPrice
      .plus(0.01) // Small tolerance
      .greaterThanOrEqualTo(currentPrice);
    const isGoodDeal = bestPrice.unitPrice
      .times(1.1) // Within 10%
      .greaterThanOrEqualTo(currentPrice);

    // `neutral`, not `ok`. The design system reserves `ok`/`warn`/`danger`
    // for state — healthy, needs-attention, wrong — and names "best price"
    // as the example of a pill that is *not* one. Green here would spend a
    // tone that has to keep meaning "this product is fine". The tick still
    // carries the good news.
    if (isBestPrice) {
      return (
        <Badge tone="neutral">
          <span className="inline-flex items-center gap-1">
            <Check aria-hidden="true" className="h-4 w-4" />
            {t("bestPrice")}
          </span>
        </Badge>
      );
    }

    if (isGoodDeal) {
      return <Badge tone="neutral">{t("priceStable")}</Badge>;
    }

    // Dearer than it needs to be, which is the one comparison here that asks
    // the reader to do something — and it says so in words. It used to read
    // "+15%" and nothing else, so what that number meant was carried by the
    // pill being amber. `premiumOver` already existed for this sentence;
    // `StoreComparison` has been using it.
    const priceDiff = new Decimal(currentPrice)
      .dividedBy(bestPrice.unitPrice)
      .minus(1)
      .times(100)
      .toFixed(0);
    return (
      <Badge tone="warn">
        {t("premiumOver", { percent: `+${priceDiff}%` })}
      </Badge>
    );
  }

  // Show best price badge
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{t("bestPrice")}:</span>
      {/* Ink, not `ok`: a ranking is not a state (see the note above). */}
      <span className="font-medium text-foreground">
        {formatUnitPrice(
          locale,
          bestPrice.unitPrice,
          bestPrice.currency ?? DEFAULT_CURRENCY,
        )}{" "}
        {t("perUnit", { unit: units.unit(bestPrice.unit, 1) })}
      </span>
      <span className="text-sm text-muted-foreground">
        {t("atStore", { store: bestPrice.store.name })}
      </span>
    </div>
  );
}
