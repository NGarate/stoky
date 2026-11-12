"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Crop, Pencil, Plus, ScanLine, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isItemReviewed } from "@/lib/receipts";
import { MatchSelector } from "./MatchSelector";
import { CreateProductInline } from "./CreateProductInline";
import { FramedLines } from "./FramedLines";
import { ReceiptLineForm, type ReceiptLine } from "./ReceiptLineForm";
import {
  ScanProductDialog,
  type ScannedProduct,
} from "@/components/barcode/ScanProductDialog";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";
import type { Decimal } from "@prisma/client-runtime-utils";

interface ProductCandidate {
  productId: string;
  name: string;
  similarity: number;
}

interface ReceiptItem {
  id: string;
  rawText: string;
  parsedName: string | null;
  parsedPrice: Decimal | null;
  parsedQuantity: Decimal | null;
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
  /** The receipt the line is on: its photo is where the line is framed. */
  receiptId: string;
  item: ReceiptItem;
  onConfirm: (
    action: "MATCH" | "CREATE" | "SKIP",
    productId?: string,
    customName?: string,
  ) => void;
  /** What OCR read, corrected: `receipt.updateItem`. */
  onCorrect: (line: ReceiptLine) => void;
  /** The line was never an article: `receipt.removeItem`. */
  onRemove: () => void;
}

export function ReviewCard({
  receiptId,
  item,
  onConfirm,
  onCorrect,
  onRemove,
}: ReviewCardProps) {
  const t = useTranslations("receipts");
  const tScan = useTranslations("products.scanPick");
  const locale = useLocale();
  const [isCreating, setIsCreating] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [isFraming, setIsFraming] = useState(false);
  /** What the framed lines read: the correction form starts from it. */
  const [reread, setReread] = useState<ReceiptLine | null>(null);
  /**
   * The product the packet in hand turned out to be. A receipt's words are
   * often not enough to match on ("LCH ENT 1L"), and the packet is usually
   * on the counter, so its code is the surest answer; it joins the
   * candidates, chosen.
   */
  const [scanned, setScanned] = useState<ScannedProduct | null>(null);
  const candidates =
    scanned && !item.candidates.some((c) => c.productId === scanned.id)
      ? [
          { productId: scanned.id, name: scanned.name, similarity: 1 },
          ...item.candidates,
        ]
      : item.candidates;
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

  const lineName = item.parsedName || item.rawText;

  const handleCorrect = (line: ReceiptLine) => {
    // A new name sends an automatic match back to waiting (the server's
    // rule), and the product picked here was picked from the old name.
    if (line.name !== item.parsedName) setSelectedProductId(null);
    onCorrect(line);
    setIsCorrecting(false);
    setReread(null);
  };

  const stopCorrecting = () => {
    setIsCorrecting(false);
    setIsFraming(false);
    setReread(null);
  };

  // Words, and the line's name in the accessible one, for the reason the
  // skip button gives below.
  const correctButton = (
    <Button
      aria-label={t("line.correctOf", { name: lineName })}
      onClick={() => setIsCorrecting(true)}
      size="sm"
      type="button"
      variant="outline"
    >
      <Pencil aria-hidden="true" className="mr-1 size-5" />
      {t("line.correct")}
    </Button>
  );

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
          <p className="font-medium text-foreground">{lineName}</p>
          {item.parsedPrice !== null && (
            <p className="text-sm text-muted-foreground">
              {formatMoney(locale, item.parsedPrice, DEFAULT_CURRENCY)}
              {item.parsedQuantity?.greaterThan(1) &&
                ` × ${item.parsedQuantity.toString()}`}
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

      {isCorrecting && isFraming ? (
        <FramedLines
          onCancel={() => setIsFraming(false)}
          onRead={(line) => {
            setReread(line);
            setIsFraming(false);
          }}
          receiptId={receiptId}
        />
      ) : isCorrecting ? (
        <div className="space-y-3">
          {/* Mounted empty, so the reading is announced when it lands. */}
          <p
            aria-live="polite"
            className="text-sm text-foreground"
            role="status"
          >
            {reread ? t("frame.read") : ""}
          </p>
          {/* Mounted again on the way back from framing, so it starts from
              what the framed lines read. */}
          <ReceiptLineForm
            defaults={
              reread
                ? {
                    name: reread.name,
                    price: reread.price?.toString() ?? "",
                    quantity: reread.quantity.toString(),
                  }
                : {
                    name: lineName,
                    price: item.parsedPrice?.toString() ?? "",
                    quantity: item.parsedQuantity?.toString() ?? "1",
                  }
            }
            onCancel={stopCorrecting}
            onSubmit={handleCorrect}
            submitLabel={t("line.save")}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              className="flex-1"
              onClick={() => setIsFraming(true)}
              type="button"
              variant="outline"
            >
              <Crop aria-hidden="true" className="mr-1 size-5" />
              {t("frame.pickLines")}
            </Button>
            <Button
              aria-label={t("line.removeOf", { name: lineName })}
              onClick={onRemove}
              type="button"
              variant="destructive"
            >
              <Trash2 aria-hidden="true" className="mr-1 size-5" />
              {t("line.remove")}
            </Button>
          </div>
        </div>
      ) : isConfirmed ? (
        correctButton
      ) : (
        <div className="space-y-3">
          {isCreating ? (
            <CreateProductInline
              defaultName={item.parsedName || ""}
              onCreate={handleCreate}
              onCancel={() => setIsCreating(false)}
            />
          ) : (
            <>
              {candidates.length > 0 && (
                <MatchSelector
                  candidates={candidates}
                  selectedId={selectedProductId}
                  onSelect={handleSelect}
                  autoMatch={
                    item.matchConfidence && item.matchConfidence >= 0.7
                      ? item.matchedProduct
                      : null
                  }
                />
              )}

              <ScanProductDialog
                onClose={() => setIsScanning(false)}
                onFound={(product) => {
                  setScanned(product);
                  setSelectedProductId(product.id);
                }}
                open={isScanning}
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  aria-label={tScan("scanLineOf", {
                    name: lineName,
                  })}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsScanning(true)}
                >
                  <ScanLine aria-hidden="true" className="mr-1 size-5" />
                  {tScan("open")}
                </Button>
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
                    name: lineName,
                  })}
                  variant="outline"
                  size="sm"
                  onClick={() => onConfirm("SKIP")}
                >
                  {t("skipLine")}
                </Button>
                {correctButton}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
