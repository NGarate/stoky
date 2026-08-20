"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { StockAmount, StockStatus } from "@/components/inventory/StockStatus";
import { Badge } from "@/components/ui/badge";
import { ItemRow } from "@/components/ui/item-row";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import { ExpiringItems } from "@/components/inventory/ExpiringItems";
import type { JSX } from "react";

/**
 * Stock overview.
 *
 * The list is a table only from `lg`. Below that it is cards, on the phone and
 * on the kitchen tablet alike (DESIGN_AUDIT A3.2, PROGRESS D14): a table at
 * 800px fits, but fitting is not the test when the screen is read from a metre
 * away. Horizontal scrolling was rejected because the column it hides first is
 * "Estado", which is the one people opened this page for.
 *
 * Nothing is dropped from the card form — product, category, stock and status
 * are all there. The card just stacks what the table puts side by side.
 */

interface StockRow {
  id: string;
  name: string;
  category: string | null;
  totalStock: number;
  defaultUnit: string;
  isLowStock: boolean;
}

/**
 * `useSearchParams` opts the subtree out of static rendering, so it has to sit
 * under a Suspense boundary or the build fails — the same shape as
 * /products/new, and for the same reason.
 */
export default function InventoryPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <InventoryView />
    </Suspense>
  );
}

/**
 * The Panel's restock overflow links here with `?filter=restock` when its
 * section cannot show everything, and the rule that created the filter binds
 * it: the rows this shows must be exactly the set the Panel counted, which is
 * why both sides ask the server the same question (`needsRestock`) instead of
 * each filtering for themselves. The filter announces itself and offers the
 * way back — a list quietly showing less than everything is how numbers stop
 * being trusted.
 */
export function InventoryView(): JSX.Element {
  const t = useTranslations("inventory");
  const filterRestock = useSearchParams().get("filter") === "restock";
  const query = api.inventory.getStockOverview.useQuery(
    filterRestock ? { limit: 100, needsRestock: true } : { limit: 50 },
  );
  const result = query.data;

  // Three states, not two. `isLoading || !result` left a failed query on
  // the skeleton for ever, with no message and no way forward — ISSUES.md
  // UI-8 — and the one failure no amount of waiting fixes is an account
  // with no household, which is HOUSE-1.
  if (!result) {
    return (
      <RouteState
        error={query.error}
        fetchStatus={query.fetchStatus}
        isLoading={query.isPending}
        onRetry={() => void query.refetch()}
        title={t("title")}
      />
    );
  }

  const products = result.products as StockRow[];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-heading md:text-4xl">
          {t("title")}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/inventory/add"
            className="inline-flex min-h-[48px] items-center rounded bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 md:text-lg"
          >
            {t("addStock")}
          </Link>
          <Link
            href="/inventory/consume"
            className="inline-flex min-h-[48px] items-center rounded border border-input bg-card px-4 py-2 text-foreground hover:bg-muted md:text-lg"
          >
            {t("consumeStock")}
          </Link>
        </div>
      </div>

      {filterRestock ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded border border-warn-foreground bg-warn px-4 py-3">
          <p className="font-medium text-warn-foreground">
            {t("filterRestockActive")}
          </p>
          <Link
            href="/inventory"
            className="inline-flex min-h-[48px] items-center text-warn-foreground underline underline-offset-4"
          >
            {t("filterClear")}
          </Link>
        </div>
      ) : (
        /* Expiration alerts — the full inventory's concern, not the filter's. */
        <div className="mb-8">
          <ExpiringItems days={7} showExpired={true} maxItems={5} />
        </div>
      )}

      {filterRestock && products.length === 0 ? (
        <p className="rounded border border-border bg-card p-4 text-muted-foreground">
          {t("filterRestockEmpty")}
        </p>
      ) : null}

      {/* Desktop: the table, which is legitimate at this tier and only here.

          Only one of the two is ever displayed, so source order does not affect
          reading order, tab order or the accessibility tree — but it does decide
          which copy a `.first()` selector resolves to, and resolving to the
          hidden one makes "the product is on the page" assert false on the tier
          where it is true. */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card shadow lg:block">
        <table className="w-full">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">{t("productHeader")}</th>
              <th className="px-4 py-3 text-left">{t("categoryHeader")}</th>
              <th className="px-4 py-3 text-right">{t("totalStockHeader")}</th>
              <th className="px-4 py-3 text-center">{t("statusHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr
                key={product.id}
                className={`border-t border-border ${
                  product.isLowStock ? "bg-warn" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/products/${product.id}`}
                    className="inline-flex min-h-[48px] items-center text-primary hover:underline font-medium"
                  >
                    {product.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Badge tone="neutral">
                    {product.category || t("noCategory")}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <StockAmount
                    defaultUnit={product.defaultUnit}
                    isLowStock={product.isLowStock}
                    totalStock={product.totalStock}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <StockStatus
                    isLowStock={product.isLowStock}
                    totalStock={product.totalStock}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone and tablet: one card per product. */}
      <ul className="space-y-3 lg:hidden">
        {products.map((product) => (
          <ItemRow
            href={`/products/${product.id}`}
            key={product.id}
            meta={[
              {
                label: t("totalStockHeader"),
                value: (
                  <StockAmount
                    defaultUnit={product.defaultUnit}
                    isLowStock={product.isLowStock}
                    totalStock={product.totalStock}
                  />
                ),
              },
              {
                label: t("categoryHeader"),
                value: product.category || t("noCategory"),
              },
            ]}
            status={
              <StockStatus
                isLowStock={product.isLowStock}
                totalStock={product.totalStock}
              />
            }
            title={product.name}
            tone={product.isLowStock ? "warn" : "neutral"}
          />
        ))}
      </ul>
    </div>
  );
}
