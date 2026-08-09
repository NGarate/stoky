"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, ArrowLeft, Package } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { ReviewCard } from "@/components/receipt/ReviewCard";
import { ReceiptStatusStep } from "@/components/receipt/ReceiptStatus";

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const receiptId = params.id as string;

  const { data: receipt, isLoading } = api.receipt.getReceiptWithItems.useQuery({
    receiptId,
  });

  const confirmAllMutation = api.receipt.confirmAll.useMutation({
    onSuccess: () => {
      router.push(`/receipts/${receiptId}/applied`);
    },
  });

  const confirmItemMutation = api.receipt.confirmItem.useMutation();
  const applyReceiptMutation = api.receipt.applyReceipt.useMutation({
    onSuccess: () => {
      router.push(`/receipts/${receiptId}/applied`);
    },
  });

  const [confirmedCount] = useState(0);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p>Cargando ticket...</p>
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p>Ticket no encontrado</p>
      </div>
    );
  }

  const totalItems = receipt.items.length;
  const pendingItems = totalItems - confirmedCount;



  const handleConfirmAll = async () => {
    const itemsToConfirm = receipt.items.map((item) => ({
      receiptItemId: item.id,
      action: (item.matchedProductId ? "MATCH" : "SKIP") as "MATCH" | "CREATE" | "SKIP",
      productId: item.matchedProductId || undefined,
    }));

    await confirmAllMutation.mutateAsync({
      receiptId,
      items: itemsToConfirm,
    });
  };

  const handleApply = async () => {
    await applyReceiptMutation.mutateAsync({ receiptId });
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/receipts">
          <Button type="button" variant="ghost" size="icon">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-heading">Revisar Ticket</h1>
          <p className="text-muted-foreground">
            {receipt.store?.name || "Tienda desconocida"}
            {receipt.purchaseDate && ` • ${new Date(receipt.purchaseDate).toLocaleDateString("es-ES")}`}
          </p>
        </div>
      </div>

      <div className="mb-6">
        <ReceiptStatusStep status={receipt.status} />
      </div>

      {receipt.status === "APPLIED" ? (
        <div className="text-center py-8 rounded-lg border border-ok-foreground bg-ok mb-6">
          <Package className="w-12 h-12 text-ok-foreground mx-auto mb-4" />
          <p className="text-ok-foreground font-medium">
            Este ticket ya ha sido aplicado al inventario
          </p>
          <Link href="/inventory">
            <Button type="button" variant="outline" className="mt-4">
              Ver inventario
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-muted-foreground">
              {pendingItems === 0
                ? "¡Todos los productos han sido revisados!"
                : `${pendingItems} productos pendientes de revisión`}
            </p>

            {receipt.status === "CONFIRMED" ? (
              <Button
                type="button"
                onClick={handleApply}
                disabled={applyReceiptMutation.isPending}
              >
                <Package className="w-4 h-4 mr-2" />
                {applyReceiptMutation.isPending
                  ? "Aplicando..."
                  : "Aplicar al inventario"}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleConfirmAll}
                disabled={pendingItems > 0 || confirmAllMutation.isPending}
              >
                <Check className="w-4 h-4 mr-2" />
                Confirmar todos
              </Button>
            )}
          </div>

          <div className="space-y-4">
            {receipt.items.map((item) => (
              <ReviewCard
                key={item.id}
                item={{
                  ...item,
                  candidates: item.candidates || [],
                }}
                onConfirm={(action, productId, customName) => {
                  confirmItemMutation.mutate({
                    receiptItemId: item.id,
                    action,
                    productId,
                    customName,
                  });
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
