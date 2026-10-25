"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isItemReviewed } from "@/lib/receipts";
import { MatchSelector } from "./MatchSelector";
import { CreateProductInline } from "./CreateProductInline";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";

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
  onConfirm: (
    action: "MATCH" | "CREATE" | "SKIP",
    productId?: string,
    customName?: string,
  ) => void;
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
  // Reviewed, but answered "leave it out": not a confirmation, and not
  // something to colour as healthy. It wore "Confirmado" on a green card.
  const isSkipped = item.matchStatus === "SKIPPED";

  const isAutoMatched = item.matchStatus === "AUTO_MATCHED";

  return (
    <div
      // Only a confirmed line is tinted, because only that is a state — and
      // its badge says it in words. An automatic match used to tint the card
      // `bg-muted`, which is where the suggestion came from, not a state.
      className={`p-4 border rounded-lg ${
        isConfirmed && !isSkipped
          ? "bg-ok border-ok-foreground"
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
              {formatMoney(locale, item.parsedPrice, DEFAULT_CURRENCY)}
              {item.parsedQuantity &&
                item.parsedQuantity > 1 &&
                ` × ${item.parsedQuantity}`}
            </p>
          )}
        </div>

        {/* A `Badge`, like every other status. It was an icon and coloured
            text, and "Auto-detectado" wore a shopping cart — the shopping
            screen's navigation icon, saying something else entirely. */}
        {isSkipped ? (
          <Badge tone="neutral">{t("itemSkipped")}</Badge>
        ) : isConfirmed ? (
          <Badge tone="ok" variant="outline">
            {t("itemConfirmed")}
          </Badge>
        ) : isAutoMatched ? (
          <Badge tone="neutral">{t("itemAutoMatched")}</Badge>
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
                  autoMatch={
                    item.matchConfidence && item.matchConfidence >= 0.7
                      ? item.matchedProduct
                      : null
                  }
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
                  <Plus aria-hidden="true" className="mr-1 size-5" />
                  {t("createProduct")}
                </Button>

                {selectedProductId && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleMatch}
                    className="flex-1"
                  >
                    <Check aria-hidden="true" className="mr-1 size-5" />
                    {t("confirmItem")}
                  </Button>
                )}

                {/* Words, not an X. The X read as "close this card", was
                    about 40px wide (under the 48px floor at `size="sm"` with
                    no label to widen it) and was named "Omitir" on every
                    line, so a list of twenty said one name twenty times.
                    The visible words start the per-line name (2.5.3). */}
                <Button
                  type="button"
                  aria-label={t("skipLineOf", {
                    name: item.parsedName || item.rawText,
                  })}
                  variant="outline"
                  size="sm"
                  onClick={() => onConfirm("SKIP")}
                >
                  {t("skipLine")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
