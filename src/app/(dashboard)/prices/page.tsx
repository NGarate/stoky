"use client";

import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { DEFAULT_CURRENCY, formatUnitPrice } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { ItemRow } from "@/components/ui/item-row";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import { BestPriceIndicator } from "@/components/price/BestPriceIndicator";

export default function PricesPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [search, setSearch] = useState("");

  // The previous answer stays up while a new search is asked, so typing does
  // not swap the page — and the field being typed in — for a loading state.
  const query = api.price.getProductPrices.useQuery(
    { search: search || undefined, limit: 50 },
    { placeholderData: keepPreviousData },
  );
  const products = query.data;

  // `!data` rather than `isLoading`, which is false for a query that is
  // paused offline or has failed — so with no signal, or after a 500, this
  // fell straight through to the empty state and told somebody they had
  // nothing. RouteState says which of loading, offline or failed it is.
  if (!products) {
    return (
      <RouteState
        error={query.error}
        fetchStatus={query.fetchStatus}
        isLoading={query.isPending}
        onRetry={() => void query.refetch()}
        title={t("prices.title")}
      />
    );
  }

  return (
    // Bounded like every other index. Unbounded, it ran the full width of the
    // layout's 7xl while `/inventory` and `/products` beside it stopped at
    // 6xl — the same list, two line lengths, depending which one you opened.
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-heading md:text-4xl">{t("prices.title")}</h1>
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
        {products.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
            <p>{t("prices.noPrices")}</p>
            <p className="mt-2 text-sm">{t("prices.addFirst")}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {products.map((product) => (
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
                    // Per unit, the figure the comparison beside it ranks
                    // by — a pack's total next to a single's price is not
                    // a comparison anybody can read.
                    value:
                      product.priceRecords.length > 0
                        ? `${formatUnitPrice(
                            locale,
                            product.priceRecords[0].unitPrice,
                            product.priceRecords[0].currency ?? DEFAULT_CURRENCY,
                          )} ${t("prices.perUnit", { unit: product.priceRecords[0].unit })}`
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
