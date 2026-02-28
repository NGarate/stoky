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
          <h1 className="text-2xl font-bold">Productos</h1>
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
        <h1 className="text-2xl font-bold">Productos</h1>
        <div className="flex gap-2">
          <Link
            href="/products/scan"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Escanear Código
          </Link>
          <Link
            href="/products/new"
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Nuevo Producto
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
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
              <tr key={product.id} className="border-t">
                <td className="px-4 py-3">
                  <Link
                    href={`/products/${product.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {product.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {product.brand || "-"}
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
                        : product.minStock &&
                            product.totalStock < product.minStock
                          ? "text-yellow-600"
                          : "text-green-600"
                    }`}
                  >
                    {product.totalStock}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <Link
                    href={`/products/${product.id}`}
                    className="text-sm text-blue-600 hover:underline"
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
