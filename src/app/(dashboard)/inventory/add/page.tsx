"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { LocationPicker } from "@/components/inventory/LocationPicker";
import { ProductPicker } from "@/components/inventory/ProductPicker";
import { api } from "@/lib/trpc/client";
import type { PickedProduct } from "@/components/inventory/ProductPicker";
import type { FormEvent, JSX } from "react";

type FieldName = "product" | "quantity" | "unit" | "expiration";

type FieldErrors = Partial<Record<FieldName, string>>;

/**
 * Turns a tRPC error into something a person can act on.
 *
 * The procedures throw plain English `Error`s, so there is no error code to
 * switch on. Matching on the message is fragile, which is why anything
 * unrecognised falls back to a generic, still-actionable message rather than
 * showing the raw text.
 */
function serverErrorKey(message: string | undefined): string {
  const normalized = message?.toLowerCase() ?? "";

  if (normalized.includes("product not found")) return "errorProductNotFound";
  if (normalized.includes("location not found")) return "errorLocationNotFound";
  if (normalized.includes("household")) return "errorNoHousehold";

  return "errorGeneric";
}

export default function AddStockPage(): JSX.Element {
  const t = useTranslations("inventory.add");
  const router = useRouter();
  const utils = api.useUtils();

  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  // True once the person edits the unit themselves, after which selecting a
  // different product must not overwrite what they typed.
  const [unitTouched, setUnitTouched] = useState(false);
  const [expiration, setExpiration] = useState("");
  const [locationId, setLocationId] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  // Bumped on every failed submit so the summary is re-focused each time, even
  // when the same errors come back twice in a row.
  const [errorSignal, setErrorSignal] = useState(0);

  const quantityId = useId();
  const quantityHintId = useId();
  const quantityErrorId = useId();
  const unitId = useId();
  const unitHintId = useId();
  const unitErrorId = useId();
  const expirationId = useId();
  const expirationHintId = useId();
  const expirationErrorId = useId();
  const locationLabelId = useId();
  const noteId = useId();
  const noteHintId = useId();

  const summaryRef = useRef<HTMLDivElement | null>(null);

  const addStock = api.inventory.addStock.useMutation({
    onSuccess: async () => {
      await utils.inventory.getStockOverview.invalidate();
      router.push("/inventory");
      router.refresh();
    },
    onError: (error) => {
      setServerError(t(serverErrorKey(error.message)));
      setErrorSignal((signal) => signal + 1);
    },
  });

  const summaryMessages = [
    fieldErrors.product,
    fieldErrors.quantity,
    fieldErrors.unit,
    fieldErrors.expiration,
    serverError,
  ].filter((message): message is string => Boolean(message));

  useEffect(() => {
    if (errorSignal > 0) {
      summaryRef.current?.focus();
    }
  }, [errorSignal]);

  function handleProductChange(selected: PickedProduct | null): void {
    setProduct(selected);
    if (selected && !unitTouched) {
      setUnit(selected.defaultUnit);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const errors: FieldErrors = {};

    if (!product) {
      errors.product = t("errorProductRequired");
    }

    const parsedQuantity = Number(quantity);
    if (
      quantity.trim() === "" ||
      !Number.isFinite(parsedQuantity) ||
      parsedQuantity <= 0
    ) {
      errors.quantity = t("errorQuantityRequired");
    }

    if (unit.trim() === "") {
      errors.unit = t("errorUnitRequired");
    }

    let expirationDate: Date | undefined;
    if (expiration !== "") {
      const parsed = new Date(expiration);
      if (Number.isNaN(parsed.getTime())) {
        errors.expiration = t("errorExpirationInvalid");
      } else {
        expirationDate = parsed;
      }
    }

    setServerError(null);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0 || !product) {
      setErrorSignal((signal) => signal + 1);
      return;
    }

    addStock.mutate({
      productId: product.id,
      quantity: parsedQuantity,
      unit: unit.trim(),
      // Required by the input schema, then ignored by the procedure, which
      // always writes PURCHASE. Sent so the Zod input validates.
      operationType: "PURCHASE",
      ...(expirationDate ? { expirationDate } : {}),
      ...(locationId ? { locationId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/inventory" className="inline-flex min-h-[48px] items-center text-primary underline">
        {t("backToInventory")}
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-heading">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("intro")}</p>

      <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-6">
        {summaryMessages.length > 0 ? (
          <div
            ref={summaryRef}
            role="alert"
            tabIndex={-1}
            className="rounded border border-danger-foreground bg-danger p-4 text-danger-foreground"
          >
            <h2 className="font-semibold">{t("errorTitle")}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {summaryMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <ProductPicker
          value={product?.id ?? ""}
          onChange={handleProductChange}
          error={fieldErrors.product}
        />

        <div>
          <label
            htmlFor={quantityId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("quantityLabel")}
          </label>
          <input
            id={quantityId}
            name="quantity"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            required
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            aria-invalid={fieldErrors.quantity ? true : undefined}
            aria-describedby={
              fieldErrors.quantity
                ? `${quantityHintId} ${quantityErrorId}`
                : quantityHintId
            }
            className="min-h-[48px] w-full rounded border border-input bg-card px-3 py-2 text-foreground"
          />
          <p id={quantityHintId} className="mt-1 text-sm text-muted-foreground">
            {t("quantityHint")}
          </p>
          {fieldErrors.quantity ? (
            <p
              id={quantityErrorId}
              className="mt-1 text-sm font-medium text-danger-foreground"
            >
              {fieldErrors.quantity}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor={unitId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("unitLabel")}
          </label>
          <input
            id={unitId}
            name="unit"
            type="text"
            required
            value={unit}
            onChange={(event) => {
              setUnitTouched(true);
              setUnit(event.target.value);
            }}
            aria-invalid={fieldErrors.unit ? true : undefined}
            aria-describedby={
              fieldErrors.unit ? `${unitHintId} ${unitErrorId}` : unitHintId
            }
            className="min-h-[48px] w-full rounded border border-input bg-card px-3 py-2 text-foreground"
          />
          <p id={unitHintId} className="mt-1 text-sm text-muted-foreground">
            {t("unitHint")}
          </p>
          {fieldErrors.unit ? (
            <p id={unitErrorId} className="mt-1 text-sm font-medium text-danger-foreground">
              {fieldErrors.unit}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor={expirationId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("expirationLabel")}
          </label>
          <input
            id={expirationId}
            name="expirationDate"
            type="date"
            value={expiration}
            onChange={(event) => setExpiration(event.target.value)}
            aria-invalid={fieldErrors.expiration ? true : undefined}
            aria-describedby={
              fieldErrors.expiration
                ? `${expirationHintId} ${expirationErrorId}`
                : expirationHintId
            }
            className="min-h-[48px] w-full rounded border border-input bg-card px-3 py-2 text-foreground"
          />
          <p id={expirationHintId} className="mt-1 text-sm text-muted-foreground">
            {t("expirationHint")}
          </p>
          {fieldErrors.expiration ? (
            <p
              id={expirationErrorId}
              className="mt-1 text-sm font-medium text-danger-foreground"
            >
              {fieldErrors.expiration}
            </p>
          ) : null}
        </div>

        {/* LocationPicker renders a combobox, not a form control, so it cannot
            be the target of a <label for>. The group and the combobox are both
            named by the same span instead. */}
        <div role="group" aria-labelledby={locationLabelId}>
          <span
            id={locationLabelId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("locationLabel")}
          </span>
          <LocationPicker
            value={locationId}
            onChange={setLocationId}
            placeholder={t("locationPlaceholder")}
            labelledBy={locationLabelId}
          />
          <p className="mt-1 text-sm text-muted-foreground">{t("locationHint")}</p>
        </div>

        <div>
          <label
            htmlFor={noteId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("noteLabel")}
          </label>
          <textarea
            id={noteId}
            name="note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("notePlaceholder")}
            aria-describedby={noteHintId}
            className="min-h-[48px] w-full rounded border border-input bg-card px-3 py-2 text-foreground"
          />
          <p id={noteHintId} className="mt-1 text-sm text-muted-foreground">
            {t("noteHint")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={addStock.isPending}
            className="min-h-[48px] rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {t("submit")}
          </button>
          <Link
            href="/inventory"
            className="inline-flex min-h-[48px] items-center rounded border border-input bg-card px-4 py-2 text-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Link>
          {/* Kept mounted so the message is announced when it appears, rather
              than the whole region arriving at once. */}
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {addStock.isPending ? t("submitting") : ""}
          </p>
        </div>
      </form>
    </div>
  );
}
