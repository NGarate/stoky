"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useId } from "react";
import { StockAmount, StockStatus } from "@/components/inventory/StockStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemRow } from "@/components/ui/item-row";
import { Pagination } from "@/components/ui/pagination";
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

/**
 * The four ways this list can be ordered, as one URL value each.
 *
 * A single `?sort=` rather than a `sort` and a `direction` pair: they are
 * never chosen independently — nobody wants "by name, descending" as a
 * separate decision from "by name" — and one parameter is one thing to
 * validate, one thing to reset, and one `<select>`.
 */
const SORT_PARAMS = {
  "name-az": { sort: "name", direction: "asc" },
  "name-za": { sort: "name", direction: "desc" },
  "stock-low": { sort: "stock", direction: "asc" },
  "stock-high": { sort: "stock", direction: "desc" },
} as const;

type SortParam = keyof typeof SORT_PARAMS;

const SORT_LABELS: Record<SortParam, string> = {
  "name-az": "sortNameAz",
  "name-za": "sortNameZa",
  "stock-low": "sortStockLow",
  "stock-high": "sortStockHigh",
};

const DEFAULT_SORT: SortParam = "name-az";
const PAGE_SIZE = 20;

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
  const common = useTranslations("common");
  const router = useRouter();
  const params = useSearchParams();
  const searchId = useId();
  const sortId = useId();

  const filterRestock = params.get("filter") === "restock";
  const search = params.get("q") ?? "";
  const sortParam = params.get("sort");
  const sortKey: SortParam =
    sortParam && sortParam in SORT_PARAMS
      ? (sortParam as SortParam)
      : DEFAULT_SORT;
  const chosen = SORT_PARAMS[sortKey];
  // A page number typed by hand can be anything. `Number("abc")` is NaN and
  // `NaN || 1` is 1, which is the right answer for every kind of nonsense.
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  const query = api.inventory.getStockOverview.useQuery({
    limit: PAGE_SIZE,
    page,
    sort: chosen.sort,
    direction: chosen.direction,
    ...(search ? { search } : {}),
    ...(filterRestock ? { needsRestock: true } : {}),
  });
  const result = query.data;

  /**
   * The same list, described differently.
   *
   * `replace` rather than `push`: a filter is a way of looking at one screen,
   * not a place you went, and pushing would make Back walk through every
   * keystroke of a search instead of leaving the page.
   */
  function go(changes: Record<string, string | null>): void {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    // Any change to what is being asked for invalidates which page you are
    // on. Page 4 of a search that has just changed is page 4 of nothing.
    if (!("page" in changes)) next.delete("page");
    const queryString = next.toString();
    router.replace(queryString ? `/inventory?${queryString}` : "/inventory");
  }

  function hrefForPage(target: number): string {
    const next = new URLSearchParams(params.toString());
    if (target <= 1) next.delete("page");
    else next.set("page", String(target));
    const queryString = next.toString();
    return queryString ? `/inventory?${queryString}` : "/inventory";
  }

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

  const products = result.products;

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

      {/* One row of controls above everything they scope, rather than a
          filter attached to each thing they filter. */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("q");
            go({ q: typeof value === "string" ? value.trim() : null });
          }}
          role="search"
        >
          <div>
            <label
              className="mb-1 block font-medium text-foreground text-sm"
              htmlFor={searchId}
            >
              {t("searchLabel")}
            </label>
            {/* A real form, submitted on Enter. A debounce would mean a timer
                in every test and a request per keystroke on a self-hosted
                box; the button is the moment the person decided. */}
            <Input
              defaultValue={search}
              id={searchId}
              key={search}
              name="q"
              placeholder={t("searchPlaceholder")}
              type="search"
            />
          </div>
          <Button type="submit" variant="outline">
            {common("search")}
          </Button>
          {search ? (
            <Button onClick={() => go({ q: null })} type="button" variant="ghost">
              {t("searchClear")}
            </Button>
          ) : null}
        </form>

        <div>
          <label
            className="mb-1 block font-medium text-foreground text-sm"
            htmlFor={sortId}
          >
            {t("sortLabel")}
          </label>
          <select
            className="min-h-[48px] rounded-md border border-input bg-card px-3 text-foreground"
            id={sortId}
            onChange={(event) => go({ sort: event.target.value })}
            value={sortKey}
          >
            {(Object.keys(SORT_PARAMS) as SortParam[]).map((option) => (
              <option key={option} value={option}>
                {t(SORT_LABELS[option])}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* How many rows this description matches, which is the question a
          filter creates and the old list could not answer at all. Polite and
          always mounted, so changing a filter is heard rather than only
          seen. */}
      <p
        aria-live="polite"
        className="mb-4 text-muted-foreground"
        role="status"
      >
        {t("resultCount", { count: result.total })}
      </p>

      {products.length === 0 && search ? (
        <p className="rounded border border-border bg-card p-4 text-muted-foreground">
          {t("searchEmpty", { search })}
        </p>
      ) : null}

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

      <Pagination
        hrefFor={hrefForPage}
        label={t("pagerLabel")}
        nextLabel={common("next")}
        page={result.page}
        pageCount={result.pageCount}
        previousLabel={common("previous")}
        status={t("pageStatus", { page: result.page, pages: result.pageCount })}
      />
    </div>
  );
}
