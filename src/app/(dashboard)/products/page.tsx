"use client";

import Link from "next/link";
import { api } from "@/lib/trpc/client";

export default function ProductsPage() {
  const { data: result, isLoading } = api.product.list.useQuery({
    limit: 20,
  });

  if (isLoading || !result) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-heading">Productos</h1>
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
        <h1 className="text-2xl font-bold text-heading">Productos</h1>
        <div className="flex gap-2">
          <Link
            href="/products/scan"
            className="px-4 py-2 rounded border border-input bg-card text-foreground hover:bg-muted"
          >
            Escanear Código
          </Link>
          <Link
            href="/products/new"
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Nuevo Producto
          </Link>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg shadow overflow-hidden">
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
            {result.products.map((product: { id: string; name: string; brand: string | null; category: string | null; totalStock: number; minStock: number | null }) => (
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
                  <span
                    className={`font-medium ${
                      product.totalStock <= 0
                        ? "text-danger-foreground"
                        : product.minStock &&
                            product.totalStock < product.minStock
                          ? "text-warn-foreground"
                          : "text-ok-foreground"
                    }`}
                  >
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
    </div>
  );
}
