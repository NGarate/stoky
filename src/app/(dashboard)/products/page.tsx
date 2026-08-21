"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { isLowStock } from "@/lib/stock/low-stock";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import type { JSX } from "react";

/**
 * The product catalogue.
 *
 * Cards below `lg`, table from `lg` (DESIGN_AUDIT A3.2, PROGRESS D14).
 *
 * The Acciones column used to hold a lone "Ver" — a second link to where the
 * name already points, and DESIGN_AUDIT A4.5's own example of a link failing
 * WCAG 2.4.9. The owner's pass replaced it (Phase 8 item 5): the name stays
 * the way in, and the column holds the product's real actions — edit, adjust,
 * the two histories — each carrying the product's name for a screen reader,
 * because a column of identical verbs says nothing about which row any of
 * them belongs to. Deleting is not here: a destructive action beside twenty
 * identical rows invites the wrong row, so it lives on the product's own
 * page, where its target is unambiguous (D98).
 *
 * The column is still absent from the cards: every action is one tap away
 * through the product's page, and four links per card would bury the reading
 * tier this layout exists for. This page was also the last one hardcoded in
 * Spanish; it reads the catalogue now.
 */

interface ProductRow {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  totalStock: number;
  minStock: number | null;
}

/** Below its minimum, out entirely, or fine. */
function stockTone(product: ProductRow): string {
  if (product.totalStock <= 0) return "text-danger-foreground";
  if (isLowStock(product.totalStock, product.minStock)) {
    return "text-warn-foreground";
  }
  return "text-ok-foreground";
}

export default function ProductsPage(): JSX.Element {
  const t = useTranslations("products.list");
  const query = api.product.list.useQuery({ limit: 100 });
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

  const products = result.products as ProductRow[];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-heading md:text-4xl">
          {t("title")}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/products/scan"
            className="inline-flex min-h-[48px] items-center rounded border border-input bg-card px-4 py-2 text-foreground hover:bg-muted md:text-lg"
          >
            {t("scan")}
          </Link>
          <Link
            href="/products/new"
            className="inline-flex min-h-[48px] items-center rounded bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 md:text-lg"
          >
            {t("new")}
          </Link>
        </div>
      </div>

      {/* Desktop: the table.

          Only one of the two is ever displayed, so source order does not affect
          reading order, tab order or the accessibility tree — but it does decide
          which copy a `.first()` selector resolves to, and resolving to the
          hidden one makes "the product is on the page" assert false on the tier
          where it is true. */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card shadow lg:block">
        <table className="w-full">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">{t("nameHeader")}</th>
              <th className="px-4 py-3 text-left">{t("brandHeader")}</th>
              <th className="px-4 py-3 text-left">{t("categoryHeader")}</th>
              <th className="px-4 py-3 text-right">{t("stockHeader")}</th>
              <th className="px-4 py-3 text-center">{t("actionsHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <Link
                    href={`/products/${product.id}`}
                    className="inline-flex min-h-[48px] items-center text-primary hover:underline"
                  >
                    {product.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {product.brand || "-"}
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 bg-muted text-muted-foreground rounded text-sm">
                    {product.category || t("noCategory")}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-medium ${stockTone(product)}`}>
                    {product.totalStock}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {/* Every link 48px in both directions (DESIGN_AUDIT A4.2)
                      and named for a screen reader with the row's product —
                      WCAG 2.4.9, the criterion the old bare "Ver" was A4.5's
                      example of failing. */}
                  <span className="flex flex-wrap items-center justify-center gap-1">
                    <Link
                      href={`/products/${product.id}/adjust`}
                      className="inline-flex min-h-[48px] items-center px-2 text-sm text-primary hover:underline"
                    >
                      {t("actionAdjust")}
                      <span className="sr-only"> {t("actionOf", { name: product.name })}</span>
                    </Link>
                    <Link
                      href={`/products/${product.id}/history`}
                      className="inline-flex min-h-[48px] items-center px-2 text-sm text-primary hover:underline"
                    >
                      {t("actionHistory")}
                      <span className="sr-only"> {t("actionOf", { name: product.name })}</span>
                    </Link>
                    <Link
                      href={`/prices/${product.id}`}
                      className="inline-flex min-h-[48px] items-center px-2 text-sm text-primary hover:underline"
                    >
                      {t("actionPrices")}
                      <span className="sr-only"> {t("actionOf", { name: product.name })}</span>
                    </Link>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone and tablet: one card per product. */}
      <ul className="space-y-3 lg:hidden">
        {products.map((product) => (
          <li
            key={product.id}
            className="rounded-lg border border-border bg-card p-4 shadow-sm md:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link
                href={`/products/${product.id}`}
                className="inline-flex min-h-[48px] items-center font-medium text-primary underline underline-offset-4 md:text-xl"
              >
                {product.name}
              </Link>
              <span className={`font-medium ${stockTone(product)} md:text-xl`}>
                {t("stockLabel", { stock: product.totalStock })}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:text-lg">
              <div>
                <dt className="text-muted-foreground">{t("brandHeader")}</dt>
                <dd className="mt-1 text-foreground">{product.brand || "-"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("categoryHeader")}</dt>
                <dd className="mt-1 text-foreground">
                  {product.category || t("noCategory")}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
