"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, X, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isItemReviewed } from "@/lib/receipts";
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
  const t = useTranslations("receipts");
  const locale = useLocale();
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

  const isConfirmed = isItemReviewed(item.matchStatus);

  const isAutoMatched = item.matchStatus === "AUTO_MATCHED";

  const moneyFormat = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }),
    [locale],
  );

  return (
    <div
      className={`p-4 border rounded-lg ${
        isConfirmed
          ? "bg-ok border-ok-foreground"
          : isAutoMatched
            ? "bg-muted border-border"
            : "bg-card border-border"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-medium text-foreground">
            {item.parsedName || item.rawText}
          </p>
          {item.parsedPrice && (
            <p className="text-sm text-muted-foreground">
              {moneyFormat.format(item.parsedPrice)}
              {item.parsedQuantity && item.parsedQuantity > 1 &&
                ` × ${item.parsedQuantity}`}
            </p>
          )}
        </div>

        {isConfirmed ? (
          <div className="flex items-center gap-1 text-ok-foreground">
            <Check className="w-4 h-4" />
            <span className="text-sm">{t("itemConfirmed")}</span>
          </div>
        ) : isAutoMatched ? (
          <div className="flex items-center gap-1 text-primary">
            <ShoppingCart className="w-4 h-4" />
            <span className="text-sm">{t("itemAutoMatched")}</span>
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
                  {t("createProduct")}
                </Button>

                {selectedProductId && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleMatch}
                    className="flex-1"
                  >
                    <Check className="w-4 h-4 mr-1" />
                    {t("confirmItem")}
                  </Button>
                )}

                {/* Icon-only, so the name has to come from the label rather
                    than from the glyph. */}
                <Button
                  type="button"
                  aria-label={t("skip")}
                  variant="ghost"
                  size="sm"
                  onClick={() => onConfirm("SKIP")}
                >
                  <X aria-hidden="true" className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
