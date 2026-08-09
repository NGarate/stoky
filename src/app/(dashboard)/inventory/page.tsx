"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";
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

export default function InventoryPage(): JSX.Element {
  const { data: result, isLoading } = api.inventory.getStockOverview.useQuery({
    limit: 50,
  });

  if (isLoading || !result) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-heading md:text-4xl">
            Inventario
          </h1>
        </div>
        <div className="space-y-4">
          {['skeleton-1', 'skeleton-2', 'skeleton-3', 'skeleton-4', 'skeleton-5'].map((key) => (
            <div key={key} className="h-16 bg-muted rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const products = result.products as StockRow[];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-heading md:text-4xl">
          Inventario
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/inventory/add"
            className="inline-flex min-h-[48px] items-center rounded bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 md:text-lg"
          >
            Añadir Stock
          </Link>
          <Link
            href="/inventory/consume"
            className="inline-flex min-h-[48px] items-center rounded border border-input bg-card px-4 py-2 text-foreground hover:bg-muted md:text-lg"
          >
            Consumir Stock
          </Link>
        </div>
      </div>

      {/* Expiration Alerts */}
      <div className="mb-8">
        <ExpiringItems days={7} showExpired={true} maxItems={5} />
      </div>

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
              <th className="px-4 py-3 text-left">Producto</th>
              <th className="px-4 py-3 text-left">Categoría</th>
              <th className="px-4 py-3 text-right">Stock Total</th>
              <th className="px-4 py-3 text-center">Estado</th>
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
                  <span className="px-2 py-1 bg-muted text-muted-foreground rounded text-sm">
                    {product.category || "Sin categoría"}
                  </span>
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
          <li
            key={product.id}
            className={`rounded-lg border border-border p-4 shadow-sm md:p-5 ${
              product.isLowStock ? "bg-warn" : "bg-card"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link
                href={`/products/${product.id}`}
                className="inline-flex min-h-[48px] items-center font-medium text-primary underline underline-offset-4 md:text-xl"
              >
                {product.name}
              </Link>
              <StockStatus
                isLowStock={product.isLowStock}
                totalStock={product.totalStock}
              />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:text-lg">
              <div>
                <dt className="text-muted-foreground">Stock Total</dt>
                <dd className="mt-1">
                  <StockAmount
                    defaultUnit={product.defaultUnit}
                    isLowStock={product.isLowStock}
                    totalStock={product.totalStock}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Categoría</dt>
                <dd className="mt-1 text-foreground">
                  {product.category || "Sin categoría"}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The quantity, tinted by how worrying it is and always carrying its unit. */
function StockAmount({
  defaultUnit,
  isLowStock,
  totalStock,
}: {
  defaultUnit: string;
  isLowStock: boolean;
  totalStock: number;
}): JSX.Element {
  return (
    <span
      className={`font-medium ${
        totalStock <= 0
          ? "text-danger-foreground"
          : isLowStock
            ? "text-warn-foreground"
            : "text-ok-foreground"
      }`}
    >
      {totalStock} {defaultUnit}
    </span>
  );
}

/**
 * The status, in words.
 *
 * The low-stock pill is outlined rather than filled: its row — and now its card
 * — is already tinted `bg-warn`, so a filled warn pill would vanish into it.
 */
function StockStatus({
  isLowStock,
  totalStock,
}: {
  isLowStock: boolean;
  totalStock: number;
}): JSX.Element {
  if (isLowStock) {
    return (
      <span className="rounded border border-warn-foreground bg-card px-2 py-1 text-sm font-medium text-warn-foreground">
        Stock Bajo
      </span>
    );
  }

  if (totalStock <= 0) {
    return (
      <span className="rounded bg-danger px-2 py-1 text-sm text-danger-foreground">
        Sin Stock
      </span>
    );
  }

  return (
    <span className="rounded bg-ok px-2 py-1 text-sm text-ok-foreground">
      OK
    </span>
  );
}
