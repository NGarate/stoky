"use client";

import { useState } from "react";
import { Check, X, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MatchSelector } from "./MatchSelector";
import { CreateProductInline } from "./CreateProductInline";

interface ProductCandidate {
  productId: string;
  name: string;
  similarity: number;
}

interface ReceiptItem {
  id: string;
  rawText: string;
  parsedName: string | null;
  parsedPrice: number | null;
  parsedQuantity: number | null;
  matchedProductId: string | null;
  matchStatus: string;
  matchConfidence: number | null;
  matchedProduct: {
    id: string;
    name: string;
  } | null;
  candidates: ProductCandidate[];
}

interface ReviewCardProps {
  item: ReceiptItem;
  onConfirm: (action: "MATCH" | "CREATE" | "SKIP", productId?: string, customName?: string) => void;
}

export function ReviewCard({ item, onConfirm }: ReviewCardProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    item.matchedProductId,
  );

  const handleSelect = (productId: string) => {
    setSelectedProductId(productId);
  };

  const handleCreate = (name: string) => {
    onConfirm("CREATE", undefined, name);
    setIsCreating(false);
  };

  const handleMatch = () => {
    if (selectedProductId) {
      onConfirm("MATCH", selectedProductId);
    }
  };

  const isConfirmed =
    item.matchStatus === "USER_CONFIRMED" ||
    item.matchStatus === "USER_CREATED" ||
    item.matchStatus === "SKIPPED";

  const isAutoMatched = item.matchStatus === "AUTO_MATCHED";

  return (
    <div
      className={`p-4 border rounded-lg ${
        isConfirmed
          ? "bg-green-50 border-green-200"
          : isAutoMatched
            ? "bg-blue-50 border-blue-200"
            : "bg-white"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-medium text-gray-900">
            {item.parsedName || item.rawText}
          </p>
          {item.parsedPrice && (
            <p className="text-sm text-gray-600">
              {item.parsedPrice.toFixed(2)} €
              {item.parsedQuantity && item.parsedQuantity > 1 &&
                ` × ${item.parsedQuantity}`}
            </p>
          )}
        </div>

        {isConfirmed ? (
          <div className="flex items-center gap-1 text-green-600">
            <Check className="w-4 h-4" />
            <span className="text-sm">Confirmado</span>
          </div>
        ) : isAutoMatched ? (
          <div className="flex items-center gap-1 text-blue-600">
            <ShoppingCart className="w-4 h-4" />
            <span className="text-sm">Auto-detectado</span>
          </div>
        ) : null}
      </div>

      {!isConfirmed && (
        <div className="space-y-3">
          {isCreating ? (
            <CreateProductInline
              defaultName={item.parsedName || ""}
              onCreate={handleCreate}
              onCancel={() => setIsCreating(false)}
            />
          ) : (
            <>
              {item.candidates.length > 0 && (
                <MatchSelector
                  candidates={item.candidates}
                  selectedId={selectedProductId}
                  onSelect={handleSelect}
                  autoMatch={item.matchConfidence && item.matchConfidence >= 0.7 ? item.matchedProduct : null}
                />
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreating(true)}
                  className="flex-1"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Crear nuevo
                </Button>

                {selectedProductId && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleMatch}
                    className="flex-1"
                  >
                    <Check className="w-4 h-4 mr-1" />
                    Confirmar
                  </Button>
                )}

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onConfirm("SKIP")}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
