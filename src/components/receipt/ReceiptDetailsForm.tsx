"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Combobox, foldText } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/trpc/client";

/** What `receipt.updateDetails` takes, less the receipt. */
export interface ReceiptDetails {
  storeId?: string;
  storeName?: string;
  purchaseDate: Date | null;
  totalAmount: number | null;
}

interface ReceiptDetailsFormProps {
  /** As typed: the shop's name, `YYYY-MM-DD`, the total; empty for none. */
  defaults: { storeName: string; date: string; total: string };
  onSubmit: (details: ReceiptDetails) => void;
  onCancel: () => void;
}

/**
 * The shop, date and total a receipt prints, corrected. The shop is chosen
 * as the upload screen chooses it — one of the household's, or a new name
 * the server creates — because without one applying records no prices.
 */
export function ReceiptDetailsForm({
  defaults,
  onSubmit,
  onCancel,
}: ReceiptDetailsFormProps) {
  const t = useTranslations("receipts");
  const common = useTranslations("common");
  const storeId = useId();
  const storeNewId = useId();
  const dateId = useId();
  const totalId = useId();
  const [storeText, setStoreText] = useState(defaults.storeName);
  const [date, setDate] = useState(defaults.date);
  const [total, setTotal] = useState(defaults.total);

  const stores = api.store.list.useQuery({ limit: 100 });
  const typedStore = storeText.trim();
  const pickedStore =
    typedStore === ""
      ? undefined
      : stores.data?.find(
          (store) => foldText(store.name) === foldText(typedStore),
        );
  const newStoreName = typedStore !== "" && !pickedStore ? typedStore : null;

  // `<input type="date">` gives `YYYY-MM-DD`, which `Date` reads as UTC
  // midnight: the instant the parser stores for a printed date on the server.
  const purchaseDate = date === "" ? null : new Date(date);
  const totalAmount = total.trim() === "" ? null : Number(total);
  const valid =
    (purchaseDate === null || !Number.isNaN(purchaseDate.getTime())) &&
    (totalAmount === null || totalAmount > 0);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      ...(pickedStore
        ? { storeId: pickedStore.id }
        : newStoreName
          ? { storeName: newStoreName }
          : {}),
      purchaseDate,
      totalAmount,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label
          htmlFor={storeId}
          className="text-sm font-medium text-foreground"
        >
          {t("uploadStoreLabel")}
        </label>
        <div className="mt-1">
          <Combobox
            aria-describedby={storeNewId}
            id={storeId}
            listLabel={t("uploadStoreList")}
            onValueChange={setStoreText}
            options={stores.data?.map((store) => store.name) ?? []}
            placeholder={t("uploadStorePlaceholder")}
            value={storeText}
          />
        </div>
        {/* Always mounted, so the sentence is announced when it appears. */}
        <p
          id={storeNewId}
          aria-live="polite"
          className="mt-1 text-sm text-foreground"
          role="status"
        >
          {newStoreName ? t("details.storeNew", { name: newStoreName }) : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={dateId}
            className="text-sm font-medium text-foreground"
          >
            {t("purchaseDate")}
          </label>
          <Input
            className="mt-1"
            id={dateId}
            onChange={(event) => setDate(event.target.value)}
            type="date"
            value={date}
          />
        </div>
        <div>
          <label
            htmlFor={totalId}
            className="text-sm font-medium text-foreground"
          >
            {t("totalAmount")}
          </label>
          <Input
            className="mt-1"
            id={totalId}
            inputMode="decimal"
            min="0"
            onChange={(event) => setTotal(event.target.value)}
            step="any"
            type="number"
            value={total}
          />
        </div>
      </div>

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
          {t("details.save")}
        </Button>
      </div>
    </form>
  );
}
