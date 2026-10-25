"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { keepPreviousData } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { DEFAULT_CURRENCY, formatUnitPrice } from "@/lib/money";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { ItemRow } from "@/components/ui/item-row";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import { BestPriceIndicator } from "@/components/price/BestPriceIndicator";
import { useQuantityFormat } from "@/lib/inventory/quantity";

export default function PricesPage() {
  const t = useTranslations();
  const units = useQuantityFormat();
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
    <PageShell width="index">
      <PageHeader title={t("prices.title")} />
      <div className="space-y-6">
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
            <Search
              aria-hidden="true"
              className="-translate-y-1/2 absolute top-1/2 left-3 size-5 text-muted-foreground"
            />
          </div>
        </div>

        {/* No card around the cards. `ItemRow` draws each row as one, so a
          bordered, shadowed box holding them put a card inside a card —
          two frames for one list, and the owner's rule is no card without a
          concrete reason (DESIGN_AUDIT A5.4). The inventory and the
          catalogue already list into a bare `<ul>`. */}
        <div>
          {/* Two different empties. A search that found nothing says so and
            offers the way back to everything; a household with no prices at
            all is told where prices come from — this screen cannot record
            one, so "Registra tu primer precio" asked for the impossible. */}
          {products.length === 0 && search ? (
            <EmptyState
              action={
                <Button
                  onClick={() => setSearch("")}
                  type="button"
                  variant="outline"
                >
                  {t("inventory.searchClear")}
                </Button>
              }
              title={t("prices.searchEmpty", { search })}
            />
          ) : products.length === 0 ? (
            <EmptyState
              action={
                <>
                  <Button asChild>
                    <Link href="/inventory/add">{t("inventory.addStock")}</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/receipts/upload">{t("receipts.upload")}</Link>
                  </Button>
                </>
              }
              body={t("prices.emptyBody")}
              title={t("prices.emptyTitle")}
            />
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
                              product.priceRecords[0].currency ??
                                DEFAULT_CURRENCY,
                            )} ${t("prices.perUnit", { unit: units.unit(product.priceRecords[0].unit, 1) })}`
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
    </PageShell>
  );
}
