"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { ItemRow } from "@/components/ui/item-row";
import { api } from "@/lib/trpc/client";
import { BestPriceIndicator } from "@/components/price/BestPriceIndicator";

export default function PricesPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [search, setSearch] = useState("");

  const { data: products, isLoading } = api.price.getProductPrices.useQuery({
    search: search || undefined,
    limit: 50,
  });

  if (isLoading) {
    return <div className="p-8">{t("common.loading")}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-heading">{t("prices.title")}</h1>
      </div>

      {/* The placeholder was doing the job of the label, which means the field
          loses its name the moment someone types in it — and keeps it lost for
          anyone who comes back to a half-filled search. A real label stays. */}
      <div>
        <label
          className="mb-1 block text-sm font-medium text-foreground"
          htmlFor="price-search"
        >
          {t("common.search")}
        </label>
        {/* The icon is positioned against this wrapper rather than the whole
            block, so the label can sit above without the magnifier drifting
            up into it. */}
        <div className="relative">
          <Input
            id="price-search"
            type="search"
            placeholder={t("products.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
          <svg
            aria-hidden="true"
            className="-translate-y-1/2 absolute top-1/2 left-3 h-5 w-5 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      {/* No card around the cards. `ItemRow` draws each row as one, so a
          bordered, shadowed box holding them put a card inside a card —
          two frames for one list, and the owner's rule is no card without a
          concrete reason (DESIGN_AUDIT A5.4). The inventory and the
          catalogue already list into a bare `<ul>`. */}
      <div>
        {products?.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
            <p>{t("prices.noPrices")}</p>
            <p className="mt-2 text-sm">{t("prices.addFirst")}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {products?.map((product) => (
              <ItemRow
                href={`/prices/${product.id}`}
                key={product.id}
                meta={[
                  {
                    label: t("products.list.categoryHeader"),
                    value: product.category ?? t("products.list.noCategory"),
                  },
                  {
                    label: t("products.lastPrice"),
                    value:
                      product.priceRecords.length > 0
                        ? formatMoney(
                            locale,
                            product.priceRecords[0].price,
                            product.priceRecords[0].currency ?? DEFAULT_CURRENCY,
                          )
                        : t("prices.noPrices"),
                  },
                ]}
                status={<BestPriceIndicator productId={product.id} />}
                title={product.name}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
