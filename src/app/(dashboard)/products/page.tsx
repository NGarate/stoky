"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";
import type { JSX } from "react";

/**
 * The product catalogue.
 *
 * Cards below `lg`, table from `lg` (DESIGN_AUDIT A3.2, PROGRESS D14).
 *
 * One column is deliberately absent from the card: **Acciones**. Its only
 * content is a "Ver" link pointing at `/products/{id}`, which is exactly where
 * the product's name already points — so on a card it would be a second link to
 * the same place, and a bare "Ver" is also the example `DESIGN_AUDIT` A4.5
 * gives of a link that fails WCAG 2.4.9 because its purpose cannot be worked
 * out from the link alone. Nothing is lost: the destination is still one tap
 * away, from a link that names what it opens. Every other column — brand,
 * category, stock — is on the card.
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
  if (product.minStock !== null && product.totalStock < product.minStock) {
    return "text-warn-foreground";
  }
  return "text-ok-foreground";
}

export default function ProductsPage(): JSX.Element {
  const { data: result, isLoading } = api.product.list.useQuery({
    limit: 20,
  });

  if (isLoading || !result) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-heading md:text-4xl">
            Productos
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

  const products = result.products as ProductRow[];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-heading md:text-4xl">
          Productos
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/products/scan"
            className="inline-flex min-h-[48px] items-center rounded border border-input bg-card px-4 py-2 text-foreground hover:bg-muted md:text-lg"
          >
            Escanear Código
          </Link>
          <Link
            href="/products/new"
            className="inline-flex min-h-[48px] items-center rounded bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 md:text-lg"
          >
            Nuevo Producto
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
              <th className="px-4 py-3 text-left">Nombre</th>
              <th className="px-4 py-3 text-left">Marca</th>
              <th className="px-4 py-3 text-left">Categoría</th>
              <th className="px-4 py-3 text-right">Stock</th>
              <th className="px-4 py-3 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <Link
                    href={`/products/${product.id}`}
                    className="text-primary hover:underline"
                  >
                    {product.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {product.brand || "-"}
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 bg-muted text-muted-foreground rounded text-sm">
                    {product.category || "Sin categoría"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-medium ${stockTone(product)}`}>
                    {product.totalStock}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <Link
                    href={`/products/${product.id}`}
                    className="text-sm text-primary hover:underline"
                  >
                    Ver
                  </Link>
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
                className="font-medium text-primary underline underline-offset-4 md:text-xl"
              >
                {product.name}
              </Link>
              <span className={`font-medium ${stockTone(product)} md:text-xl`}>
                Stock: {product.totalStock}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:text-lg">
              <div>
                <dt className="text-muted-foreground">Marca</dt>
                <dd className="mt-1 text-foreground">{product.brand || "-"}</dd>
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
