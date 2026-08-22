"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ItemRow } from "@/components/ui/item-row";
import {
  StockAmount,
  StockStatus,
} from "@/components/inventory/StockStatus";
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
  defaultUnit: string;
}

/**
 * One of a row's onward links.
 *
 * Named for a screen reader with the row's product, because "Ajustar" read
 * out of context names nothing — WCAG 2.4.9, and the criterion the old bare
 * "Ver" was DESIGN_AUDIT A4.5's example of failing. A link rather than a
 * button because it genuinely navigates.
 */
function RowAction({
  href,
  label,
  name,
}: {
  href: string;
  label: string;
  name: string;
}): JSX.Element {
  return (
    <Button asChild size="sm" variant="ghost">
      <Link href={href}>
        {label}
        <span className="sr-only"> {name}</span>
      </Link>
    </Button>
  );
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
  // `product.list` returns a cursor when it held something back. The screen
  // asked for a hundred and drew exactly what it was given, so a household
  // with more than that had a catalogue that simply ended — no page two, no
  // count, and nothing to say a product that exists is not on the screen.
  const truncated = Boolean(result.nextCursor);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-heading md:text-4xl">
          {t("title")}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/products/scan">{t("scan")}</Link>
          </Button>
          <Button asChild>
            <Link href="/products/new">{t("new")}</Link>
          </Button>
        </div>
      </div>

      {truncated ? (
        <p className="mb-4 rounded border border-border bg-card p-3 text-sm text-muted-foreground">
          {t("truncated", { count: products.length })}
        </p>
      ) : null}

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
                  <Button asChild variant="link">
                    <Link href={`/products/${product.id}`}>{product.name}</Link>
                  </Button>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {product.brand || "-"}
                </td>
                <td className="px-4 py-3">
                  <Badge tone="neutral">
                    {product.category || t("noCategory")}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {/* The number and what it means, in the same cell rather
                      than a new column: the state was carried by the colour
                      of the number and by nothing else. */}
                  <span className="flex items-center justify-end gap-2">
                    <StockAmount
                      defaultUnit={product.defaultUnit}
                      isLowStock={isLowStock(product.totalStock, product.minStock)}
                      totalStock={product.totalStock}
                    />
                    <StockStatus
                      isLowStock={isLowStock(product.totalStock, product.minStock)}
                      totalStock={product.totalStock}
                    />
                  </span>
                </td>
                <td className="px-4 py-3">
                  {/* Every link 48px in both directions (DESIGN_AUDIT A4.2)
                      and named for a screen reader with the row's product —
                      WCAG 2.4.9, the criterion the old bare "Ver" was A4.5's
                      example of failing. */}
                  <span className="flex flex-wrap items-center justify-center gap-1">
                    <RowAction
                      href={`/products/${product.id}/adjust`}
                      label={t("actionAdjust")}
                      name={t("actionOf", { name: product.name })}
                    />
                    <RowAction
                      href={`/products/${product.id}/history`}
                      label={t("actionHistory")}
                      name={t("actionOf", { name: product.name })}
                    />
                    <RowAction
                      href={`/prices/${product.id}`}
                      label={t("actionPrices")}
                      name={t("actionOf", { name: product.name })}
                    />
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
          <ItemRow
            actions={
              <>
                <RowAction
                  href={`/products/${product.id}/adjust`}
                  label={t("actionAdjust")}
                  name={t("actionOf", { name: product.name })}
                />
                <RowAction
                  href={`/products/${product.id}/history`}
                  label={t("actionHistory")}
                  name={t("actionOf", { name: product.name })}
                />
                <RowAction
                  href={`/prices/${product.id}`}
                  label={t("actionPrices")}
                  name={t("actionOf", { name: product.name })}
                />
              </>
            }
            href={`/products/${product.id}`}
            key={product.id}
            meta={[
              {
                label: t("stockHeader"),
                value: (
                  <StockAmount
                    defaultUnit={product.defaultUnit}
                    isLowStock={isLowStock(product.totalStock, product.minStock)}
                    totalStock={product.totalStock}
                  />
                ),
              },
              { label: t("brandHeader"), value: product.brand || "-" },
              {
                label: t("categoryHeader"),
                value: product.category || t("noCategory"),
              },
            ]}
            /* The state in words, from the one component that decides it.
               This screen used to say it in colour and nothing else — a
               coloured number, with "bajo" and "sin stock" never written
               anywhere (WCAG 1.4.1) — and it worked the answer out for
               itself, which made four derivations of a rule that already had
               a home. */
            status={
              <StockStatus
                isLowStock={isLowStock(product.totalStock, product.minStock)}
                totalStock={product.totalStock}
              />
            }
            title={product.name}
          />
        ))}
      </ul>
    </div>
  );
}
