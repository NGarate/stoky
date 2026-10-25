"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useId } from "react";
import { Select } from "@/components/ui/select";
import {
  StockAmount,
  StockStatus,
  stockTone,
} from "@/components/inventory/StockStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemRow } from "@/components/ui/item-row";
import { PageHeader, PageShell } from "@/components/ui/page-header";
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
/** The ceiling `stockOverviewSchema` enforces, so the client cannot exceed it. */
const MAX_PAGE = 10_000;

/**
 * The table's tint per tone. `ItemRow` owns the card tier's; this tier is a
 * `<tr>`, which no primitive covers, so the mapping is written out once here
 * rather than derived a second time from the stock numbers.
 */
const ROW_TINTS: Record<ReturnType<typeof stockTone>, string> = {
  neutral: "",
  warn: "bg-warn",
  danger: "bg-danger",
};

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
  const tProducts = useTranslations("products");
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
  //
  // Floored and capped as well, to the same ceiling the schema enforces: an
  // unfloored 1.5 and an uncapped 1e19 were both rejected by the server —
  // one by Zod, one by Postgres running out of bigint — and a URL somebody
  // typed should land on a page rather than on a failure.
  const page = Math.min(
    MAX_PAGE,
    Math.max(1, Math.floor(Number(params.get("page") ?? 1) || 1)),
  );

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
  // Neither needs the list to have arrived, so both are drawn while it has
  // not — RouteState puts them in the same place the loaded screen does.
  const actions = (
    <>
      <Button asChild>
        <Link href="/inventory/add">{t("addStock")}</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/inventory/consume">{t("consumeStock")}</Link>
      </Button>
    </>
  );

  if (!result) {
    return (
      <RouteState
        actions={actions}
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
    <PageShell width="index">
      <PageHeader actions={actions} title={t("title")} />

      {filterRestock ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded border border-warn-foreground bg-warn px-4 py-3">
          <p className="font-medium text-warn-foreground">
            {t("filterRestockActive")}
          </p>
          <Button asChild variant="link">
            <Link href="/inventory"> {t("filterClear")} </Link>
          </Button>
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
            <Button
              onClick={() => go({ q: null })}
              type="button"
              variant="ghost"
            >
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
          <Select
            id={sortId}
            onChange={(event) => go({ sort: event.target.value })}
            value={sortKey}
          >
            {(Object.keys(SORT_PARAMS) as SortParam[]).map((option) => (
              <option key={option} value={option}>
                {t(SORT_LABELS[option])}
              </option>
            ))}
          </Select>
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
        <EmptyState
          action={
            <Button
              onClick={() => go({ q: null })}
              type="button"
              variant="outline"
            >
              {t("searchClear")}
            </Button>
          }
          title={t("searchEmpty", { search })}
        />
      ) : null}

      {filterRestock && products.length === 0 ? (
        // No action of its own: the filter banner directly above already
        // offers "Ver todo el inventario", and twice is the same control.
        <EmptyState title={t("filterRestockEmpty")} />
      ) : null}

      {/* A household with no products at all. This drew a table header
          over nothing and "0 productos" above it — accurate, and no help to
          somebody who has just arrived. The header's "Añadir stock" needs a
          product to add stock *to*, so the way in is making the first one. */}
      {result.total === 0 && !search && !filterRestock ? (
        <EmptyState
          action={
            <>
              <Button asChild>
                <Link href="/products/new">{tProducts("list.new")}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/products/scan">{tProducts("list.scan")}</Link>
              </Button>
            </>
          }
          body={tProducts("addFirst")}
          title={tProducts("noProducts")}
        />
      ) : null}

      {/* A page past the end used to be a blank screen with a pager reading
          "Página 500 de 3" and nothing to explain it — the two empty states
          above both need a search or a filter to speak, and a stray page
          number has neither. */}
      {result.pageCount > 0 && result.page > result.pageCount ? (
        <EmptyState
          action={
            <Button asChild variant="outline">
              <Link href={hrefForPage(result.pageCount)}>
                {t("goToLastPage")}
              </Link>
            </Button>
          }
          title={t("pagePastEnd", { pages: result.pageCount })}
        />
      ) : null}

      {/* Desktop: the table, which is legitimate at this tier and only here.

          Only one of the two is ever displayed, so source order does not affect
          reading order, tab order or the accessibility tree — but it does decide
          which copy a `.first()` selector resolves to, and resolving to the
          hidden one makes "the product is on the page" assert false on the tier
          where it is true. */}
      {products.length > 0 ? (
        <div className="hidden overflow-hidden rounded-lg border border-border bg-card shadow lg:block">
          <table className="w-full">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">{t("productHeader")}</th>
                <th className="px-4 py-3 text-left">{t("categoryHeader")}</th>
                <th className="px-4 py-3 text-right">
                  {t("totalStockHeader")}
                </th>
                <th className="px-4 py-3 text-center">{t("statusHeader")}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  key={product.id}
                  className={`border-t border-border ${
                    ROW_TINTS[stockTone(product.totalStock, product.isLowStock)]
                  }`}
                >
                  <td className="px-4 py-3">
                    <Button asChild variant="link">
                      <Link href={`/products/${product.id}`}>
                        {" "}
                        {product.name}{" "}
                      </Link>
                    </Button>
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
                      onTintedRow
                      totalStock={product.totalStock}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

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
                onTintedRow
                totalStock={product.totalStock}
              />
            }
            title={product.name}
            tone={stockTone(product.totalStock, product.isLowStock)}
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
    </PageShell>
  );
}
