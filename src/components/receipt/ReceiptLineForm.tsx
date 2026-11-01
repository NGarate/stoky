"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ReceiptLine {
  name: string;
  /** The line's total, as `receipt.updateItem` and `addItem` take it. */
  price?: number;
  quantity: number;
}

interface ReceiptLineFormProps {
  /** As typed: empty strings for a new line. */
  defaults?: { name: string; price: string; quantity: string };
  submitLabel: string;
  onSubmit: (line: ReceiptLine) => void;
  onCancel: () => void;
}

/**
 * A receipt line as a person reads it off the photograph: correcting one OCR
 * misread, or adding one it missed. The server's `receiptLineSchema` is the
 * check; this only declines to send what it would refuse.
 */
export function ReceiptLineForm({
  defaults = { name: "", price: "", quantity: "1" },
  submitLabel,
  onSubmit,
  onCancel,
}: ReceiptLineFormProps) {
  const t = useTranslations("receipts.line");
  const common = useTranslations("common");
  // Generated: several cards can have their form open at once.
  const nameId = useId();
  const priceId = useId();
  const priceHintId = useId();
  const quantityId = useId();
  const [name, setName] = useState(defaults.name);
  const [price, setPrice] = useState(defaults.price);
  const [quantity, setQuantity] = useState(defaults.quantity);

  const parsedPrice = price.trim() === "" ? undefined : Number(price);
  const parsedQuantity = Number(quantity);
  const valid =
    name.trim() !== "" &&
    parsedQuantity > 0 &&
    (parsedPrice === undefined || parsedPrice > 0);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      price: parsedPrice,
      quantity: parsedQuantity,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor={nameId} className="text-sm font-medium text-foreground">
          {t("nameLabel")}
        </label>
        <Input
          autoFocus
          className="mt-1"
          id={nameId}
          onChange={(event) => setName(event.target.value)}
          type="text"
          value={name}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={priceId}
            className="text-sm font-medium text-foreground"
          >
            {t("priceLabel")}
          </label>
          <Input
            aria-describedby={priceHintId}
            className="mt-1"
            id={priceId}
            inputMode="decimal"
            min="0"
            onChange={(event) => setPrice(event.target.value)}
            step="any"
            type="number"
            value={price}
          />
        </div>
        <div>
          <label
            htmlFor={quantityId}
            className="text-sm font-medium text-foreground"
          >
            {t("quantityLabel")}
          </label>
          <Input
            className="mt-1"
            id={quantityId}
            inputMode="decimal"
            min="0"
            onChange={(event) => setQuantity(event.target.value)}
            step="any"
            type="number"
            value={quantity}
          />
        </div>
      </div>
      <p id={priceHintId} className="text-sm text-muted-foreground">
        {t("priceHint")}
      </p>

      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          {common("cancel")}
        </Button>
        <Button className="flex-1" disabled={!valid} type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
