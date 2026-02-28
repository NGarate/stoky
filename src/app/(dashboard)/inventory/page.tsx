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
          <h1 className="text-2xl font-bold">Inventario</h1>
        </div>
        <div className="space-y-4">
          {['skeleton-1', 'skeleton-2', 'skeleton-3', 'skeleton-4', 'skeleton-5'].map((key) => (
            <div key={key} className="h-16 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Inventario</h1>
        <div className="flex gap-2">
          <Link
            href="/inventory/add"
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Añadir Stock
          </Link>
          <Link
            href="/inventory/consume"
            className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
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
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
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
                className={`border-t ${
                  product.isLowStock ? "bg-red-50" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/products/${product.id}`}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    {product.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 bg-gray-100 rounded text-sm">
                    {product.category || "Sin categoría"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={`font-medium ${
                      product.totalStock <= 0
                        ? "text-red-600"
                        : product.isLowStock
                          ? "text-yellow-600"
                          : "text-green-600"
                    }`}
                  >
                    {product.totalStock} {product.defaultUnit}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {product.isLowStock ? (
                    <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-sm font-medium">
                      Stock Bajo
                    </span>
                  ) : product.totalStock <= 0 ? (
                    <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded text-sm">
                      Sin Stock
                    </span>
                  ) : (
                    <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm">
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
