"use client";

import Link from "next/link";
import { Plus, FileText } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { ReceiptStatusBadge } from "@/components/receipt/ReceiptStatus";
import { formatDate } from "@/lib/utils";

import type { ReceiptStatus } from "@prisma/client";

interface Receipt {
  id: string;
  status: ReceiptStatus;
  store: { name: string } | null;
  createdAt: Date;
  purchaseDate: Date | null;
  totalAmount: number | null;
  _count: { items: number };
}

export default function ReceiptsPage() {
  const { data, isLoading } = api.receipt.list.useQuery({ limit: 50 });
  const receipts: Receipt[] = data?.items ?? [];

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Tickets</h1>
        </div>
        <div className="text-center py-12">
          <p className="text-gray-600">Cargando tickets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tickets</h1>
        <Link href="/receipts/upload">
          <Button type="button">
            <Plus className="w-4 h-4 mr-2" />
            Subir ticket
          </Button>
        </Link>
      </div>

      {receipts.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-2">No tienes tickets guardados</p>
          <p className="text-sm text-gray-500">
            Sube tu primer ticket para empezar a gestionar tu inventario
          </p>
          <Link href="/receipts/upload">
            <Button type="button" variant="outline" className="mt-4">
              Subir ticket
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {receipts.map((receipt) => (
          <Link
            key={receipt.id}
            href={
              receipt.status === "NEEDS_REVIEW" || receipt.status === "CONFIRMED"
                ? `/receipts/${receipt.id}/review`
                : "/receipts/upload"
            }
              className="block p-4 border rounded-lg hover:border-blue-300 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {receipt.store?.name || "Tienda desconocida"}
                  </p>
                  <p className="text-sm text-gray-500">
                    {formatDate(receipt.createdAt)}
                    {receipt.totalAmount && ` • ${receipt.totalAmount.toFixed(2)} €`}
                    {receipt._count.items > 0 && ` • ${receipt._count.items} productos`}
                  </p>
                </div>
                <ReceiptStatusBadge status={receipt.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
