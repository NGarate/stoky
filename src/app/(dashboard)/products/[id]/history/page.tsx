"use client";

import { useLocale, useTranslations } from "next-intl";
import { use, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ItemRow } from "@/components/ui/item-row";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { RouteState } from "@/components/household/RouteState";
import { api } from "@/lib/trpc/client";
import { runningTotals } from "@/lib/inventory/stockLedger";
import { StockHistoryChart } from "@/components/inventory/StockHistoryChart";
import { useQuantityFormat } from "@/lib/inventory/quantity";
import type { JSX } from "react";
import { formatDate } from "@/lib/dates";

/**
 * The product's ledger, made visible — "the only screen that shows why the
 * number is what it is" (`getStockHistory`'s own docblock, which described
 * this screen for months before Phase 8 item 5 built it).
 *
 * The chart's running totals are derived backwards from the current net
 * (`runningTotals`), so a partially loaded ledger still draws only exact
 * points; loading more extends the line leftwards and never moves a point
 * already drawn.
 */
interface StockHistoryPageProps {
  params: Promise<{ id: string }>;
}

export default function StockHistoryPage({
  params,
}: StockHistoryPageProps): JSX.Element {
  const { id } = use(params);
  return <StockHistoryView id={id} />;
}

/** Exported apart from the route so the component suite can render it. */
export function StockHistoryView({ id }: { id: string }): JSX.Element {
  const t = useTranslations("products.history");
  const units = useQuantityFormat();
  const tDetail = useTranslations("products.detail");
  const locale = useLocale();

  const detail = api.product.getById.useQuery({ id }, { retry: false });
  const history = api.inventory.getStockHistory.useInfiniteQuery(
    { productId: id, limit: 100 },
    {
      retry: false,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );

  const product = detail.data;
  const entries = useMemo(
    () => history.data?.pages.flatMap((page) => page.entries) ?? [],
    [history.data],
  );

  const points = useMemo(
    () => (product ? runningTotals(entries, product.totalStock) : []),
    [entries, product],
  );


  const back = { href: `/products/${id}`, label: t("backToProduct") };

  // Two questions, one screen: whichever has not answered is the one the
  // screen is waiting on, and the product's first, because a product that
  // does not exist has no history to wait for.
  if (!product || !history.data) {
    const waiting = !product ? detail : history;
    return (
      <RouteState
        back={back}
        error={waiting.error}
        fetchStatus={waiting.fetchStatus}
        isLoading={waiting.isPending}
        notFound={{
          title: tDetail("notFoundTitle"),
          body: t("errorNotFound"),
          back: { href: "/products", label: tDetail("backToProducts") },
        }}
        onRetry={() => {
          void detail.refetch();
          void history.refetch();
        }}
        title={t("title")}
        width="detail"
      />
    );
  }

  return (
    <PageShell width="detail">
      <PageHeader
        back={back}
        className="mb-0"
        intro={t("intro")}
        title={t("titleOf", { name: product.name })}
      />
      <p className="mt-2 font-medium text-foreground">
        {t("currentTotal", {
          stock: product.totalStock,
          unit: units.unit(product.defaultUnit, product.totalStock),
        })}
      </p>

      {entries.length === 0 ? (
        <p className="mt-6 rounded border border-border bg-card p-4 text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <>
          <div className="mt-6 rounded border border-border bg-card p-4">
            <StockHistoryChart
              points={[...points]
                .reverse()
                .map((point) => ({
                  date: new Date(point.createdAt).toISOString(),
                  total: point.total,
                }))}
              unit={product.defaultUnit}
            />
          </div>

          {/* Phone and tablet: one card per movement. Five columns at 390px
              under `overflow-hidden` clipped "Ubicación" and "Quedó" off the
              edge — lost as completely as if never sent (DESIGN_AUDIT A3.3).
              Every column is on the card; the table is for `lg` only, as on
              /inventory and /products (A3.2). */}
          <ul className="mt-6 space-y-3 lg:hidden">
            {points.map((point) => {
              const entry = entries.find((row) => row.id === point.id);
              if (!entry) return null;
              return (
                <ItemRow
                  key={entry.id}
                  meta={[
                    { label: t("typeHeader"), value: t(`op${entry.operationType}`) },
                    {
                      label: t("changeHeader"),
                      value: `${entry.quantity > 0 ? "+" : ""}${units.quantity(entry.quantity, entry.unit)}`,
                    },
                    {
                      label: t("locationHeader"),
                      value: entry.location?.name ?? t("noLocation"),
                    },
                    {
                      label: t("totalHeader"),
                      value: units.quantity(point.total, product.defaultUnit),
                    },
                  ]}
                  title={formatDate(locale, entry.createdAt, "short")}
                />
              );
            })}
          </ul>

          <div className="mt-6 hidden overflow-hidden rounded-lg border border-border bg-card shadow lg:block">
            <table className="w-full">
              <caption className="sr-only">{t("tableCaption")}</caption>
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">{t("dateHeader")}</th>
                  <th className="px-4 py-3 text-left">{t("typeHeader")}</th>
                  <th className="px-4 py-3 text-right">{t("changeHeader")}</th>
                  <th className="px-4 py-3 text-left">{t("locationHeader")}</th>
                  <th className="px-4 py-3 text-right">{t("totalHeader")}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => {
                  const entry = entries.find((row) => row.id === point.id);
                  if (!entry) return null;
                  return (
                    <tr key={entry.id} className="border-t border-border">
                      <td className="px-4 py-3 text-foreground">
                        {formatDate(locale, entry.createdAt, "short")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {t(`op${entry.operationType}`)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${
                          entry.quantity < 0
                            ? "text-danger-foreground"
                            : "text-ok-foreground"
                        }`}
                      >
                        {entry.quantity > 0 ? "+" : ""}
                        {units.quantity(entry.quantity, entry.unit)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {entry.location?.name ?? t("noLocation")}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {units.quantity(point.total, product.defaultUnit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {history.hasNextPage ? (
            <Button
              type="button"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
            </Button>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
