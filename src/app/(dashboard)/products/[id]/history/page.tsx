"use client";

import { useLocale, useTranslations } from "next-intl";
import { use, useMemo } from "react";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
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
function serverErrorKey(message: string | undefined): string {
  const normalized = message?.toLowerCase() ?? "";

  if (normalized.includes("product not found")) return "errorNotFound";
  if (normalized.includes("household")) return "errorNoHousehold";

  return "errorGeneric";
}

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


  const failed = detail.error ?? history.error;
  if (failed) {
    const errorKey = serverErrorKey(failed.message);

    return (
      <div className="mx-auto max-w-3xl">
        <BackLink href="/products">{t("backToProduct")}</BackLink>

        <div
          role="alert"
          className="mt-2 rounded border border-danger-foreground bg-danger p-4 text-danger-foreground"
        >
          <h1 className="text-2xl font-bold">{t("errorTitle")}</h1>
          <p className="mt-2">{t(errorKey)}</p>
        </div>

        {errorKey === "errorNotFound" ? null : (
          <Button
            type="button"
            onClick={() => {
              void detail.refetch();
              void history.refetch();
            }}
          >
            {t("retry")}
          </Button>
        )}
      </div>
    );
  }

  if (!product || !history.data) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mt-2 text-2xl font-bold text-heading">{t("title")}</h1>
        <p role="status" aria-live="polite" className="mt-2 text-muted-foreground">
          {t("loading")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink href={`/products/${id}`}>{t("backToProduct")}</BackLink>

      <h1 className="mt-2 text-2xl font-bold text-heading">
        {t("titleOf", { name: product.name })}
      </h1>
      <p className="mt-2 text-muted-foreground">{t("intro")}</p>
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

          <div className="mt-6 overflow-hidden rounded-lg border border-border bg-card shadow">
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
    </div>
  );
}
