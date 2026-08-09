"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { ExpiringItems } from "@/components/inventory/ExpiringItems";

export default function InventoryPage() {
  const { data: result, isLoading } = api.inventory.getStockOverview.useQuery({
    limit: 50,
  });

  if (isLoading || !result) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-heading">Inventario</h1>
        </div>
        <div className="space-y-4">
          {['skeleton-1', 'skeleton-2', 'skeleton-3', 'skeleton-4', 'skeleton-5'].map((key) => (
            <div key={key} className="h-16 bg-muted rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-heading">Inventario</h1>
        <div className="flex gap-2">
          <Link
            href="/inventory/add"
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Añadir Stock
          </Link>
          <Link
            href="/inventory/consume"
            className="px-4 py-2 rounded border border-input bg-card text-foreground hover:bg-muted"
          >
            Consumir Stock
          </Link>
        </div>
      </div>

      {/* Expiration Alerts */}
      <div className="mb-8">
        <ExpiringItems days={7} showExpired={true} maxItems={5} />
      </div>

      {/* Stock Overview Table */}
      <div className="bg-card border border-border rounded-lg shadow overflow-hidden">
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
            {result.products.map((product: { id: string; name: string; category: string | null; totalStock: number; defaultUnit: string; isLowStock: boolean }) => (
              <tr
                key={product.id}
                className={`border-t border-border ${
                  product.isLowStock ? "bg-warn" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/products/${product.id}`}
                    className="text-primary hover:underline font-medium"
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
                  <span
                    className={`font-medium ${
                      product.totalStock <= 0
                        ? "text-danger-foreground"
                        : product.isLowStock
                          ? "text-warn-foreground"
                          : "text-ok-foreground"
                    }`}
                  >
                    {product.totalStock} {product.defaultUnit}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {/* The low-stock pill is outlined rather than filled: its row
                      is already tinted `bg-warn`, so a filled warn pill would
                      vanish into it. */}
                  {product.isLowStock ? (
                    <span className="px-2 py-1 rounded border border-warn-foreground bg-card text-warn-foreground text-sm font-medium">
                      Stock Bajo
                    </span>
                  ) : product.totalStock <= 0 ? (
                    <span className="px-2 py-1 bg-danger text-danger-foreground rounded text-sm">
                      Sin Stock
                    </span>
                  ) : (
                    <span className="px-2 py-1 bg-ok text-ok-foreground rounded text-sm">
                      OK
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
