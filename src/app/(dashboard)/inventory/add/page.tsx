"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { LocationPicker } from "@/components/inventory/LocationPicker";
import { ProductPicker } from "@/components/inventory/ProductPicker";
import { StoreSelector } from "@/components/store/StoreSelector";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/lib/trpc/client";
import { useEnvelope } from "@/components/offline/Composer";
import type { PickedProduct } from "@/components/inventory/ProductPicker";
import type { FormEvent, JSX } from "react";

type FieldName = "product" | "quantity" | "unit" | "expiration" | "price" | "store";

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
  if (normalized.includes("unit cannot be converted")) return "errorUnitMismatch";
  if (normalized.includes("household")) return "errorNoHousehold";

  return "errorGeneric";
}

export default function AddStockPage(): JSX.Element {
  const t = useTranslations("inventory.add");
  const envelope = useEnvelope();
  const router = useRouter();
  const utils = api.useUtils();

  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  // True once the person edits the unit themselves, after which selecting a
  // different product must not overwrite what they typed.
  const [unitTouched, setUnitTouched] = useState(false);
  const [expiration, setExpiration] = useState("");
  const [storeId, setStoreId] = useState("");
  const [price, setPrice] = useState("");
  const [locationId, setLocationId] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  // The folded half of the form. Uncontrolled — a controlled <details> races
  // hydration: a native click before React attaches flips it open, and the
  // first render after hydration snaps it shut again. The one programmatic
  // need (a refusal about a folded field must not point at a closed drawer)
  // is imperative, through the ref.
  const advancedRef = useRef<HTMLDetailsElement | null>(null);

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
  const storeFieldId = useId();
  const storeHintId = useId();
  const storeErrorId = useId();
  const priceId = useId();
  const priceHintId = useId();
  const priceErrorId = useId();
  const [saved, setSaved] = useState<{
    name: string;
    quantity: number;
    unit: string;
  } | null>(null);

  const addStock = api.inventory.addStock.useMutation({
    /**
     * Report what was written, rather than redirecting in silence.
     *
     * This used to `router.push("/inventory")`, and the destination has no
     * live region — so the entire confirmation a screen-reader user received
     * was Next's route announcer reading "Inventario". That is the same word
     * it reads when somebody clicks Inventario in the navigation and saves
     * nothing: it answers "where am I", never "did that work" (ISSUES.md
     * A11Y-1).
     *
     * Saying it here also answers *how much* and *of what* without walking the
     * table, which the redirect could never do. Same shape as
     * `/products/new`, which is why PROGRESS.md D8 exists.
     */
    onSuccess: async (_data, variables) => {
      setSaved({
        name: product?.name ?? "",
        quantity: Math.abs(variables.quantity),
        unit: variables.unit,
      });
      await utils.inventory.getStockOverview.invalidate();
      router.refresh();
    },
    onError: (error) => {
      const key = serverErrorKey(error.message);
      setServerError(t(key, { unit: product?.defaultUnit ?? "" }));
      // The unit lives in the folded half; a refusal about it must not point
      // at a closed drawer.
      if (key === "errorUnitMismatch") advancedRef.current?.setAttribute("open", "");
      setErrorSignal((signal) => signal + 1);
    },
  });

  const summaryMessages = [
    fieldErrors.product,
    fieldErrors.quantity,
    fieldErrors.unit,
    fieldErrors.expiration,
    fieldErrors.price,
    fieldErrors.store,
    serverError,
  ].filter((message): message is string => Boolean(message));

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

    let parsedPrice: number | undefined;
    if (price.trim() !== "") {
      const parsed = Number(price);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        errors.price = t("errorPriceInvalid");
      } else {
        parsedPrice = parsed;
      }
    }

    // A price with no store cannot be recorded — `PriceRecord.storeId` is
    // required — and the server would accept the call and quietly write
    // nothing, which is worse than refusing here with the fix named.
    if (parsedPrice !== undefined && storeId === "") {
      errors.store = t("errorPriceNeedsStore");
    }

    setServerError(null);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0 || !product) {
      // An error about a folded field must not point at a closed drawer.
      if (errors.unit) advancedRef.current?.setAttribute("open", "");
      setErrorSignal((signal) => signal + 1);
      return;
    }

    addStock.mutate({
      ...envelope(),
      productId: product.id,
      quantity: parsedQuantity,
      unit: unit.trim(),
      ...(expirationDate ? { expirationDate } : {}),
      ...(locationId ? { locationId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(parsedPrice !== undefined ? { price: parsedPrice } : {}),
      ...(storeId !== "" ? { storeId } : {}),
    });
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Over the form rather than instead of it. A11Y-1 is why this is a
          dialog and not a snackbar: focus moves into it, so the confirmation
          is announced rather than left to Next's route announcer reading the
          destination's name. Closing it is what "Añadir otro" used to be —
          the form is still underneath, exactly as it was left. */}
      <Dialog
        description={
          saved
            ? t("successBody", {
                quantity: saved.quantity,
                unit: saved.unit,
                name: saved.name,
              })
            : undefined
        }
        footer={
          <>
            <Button asChild variant="outline">
              <Link href="/inventory">{t("successViewInventory")}</Link>
            </Button>
            <Button onClick={() => setSaved(null)} type="button">
              {t("successAddMore")}
            </Button>
          </>
        }
        onClose={() => setSaved(null)}
        open={saved !== null}
        title={t("successTitle")}
      />

      <BackLink href="/inventory">{t("backToInventory")}</BackLink>

      <h1 className="mt-2 text-2xl font-bold text-heading">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("intro")}</p>

      <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-6">
        <FormErrorSummary
          focusSignal={errorSignal}
          messages={summaryMessages}
          title={t("errorTitle")}
        />

        <ProductPicker
          hint={t("productSelectHint")}
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
          <Input
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
            htmlFor={expirationId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("expirationLabel")}
          </label>
          <Input
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

        <div>
          <label
            htmlFor={storeFieldId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("storeLabel")}
          </label>
          <StoreSelector
            id={storeFieldId}
            value={storeId}
            onChange={(selected) => {
              setStoreId(selected);
              setFieldErrors((errors) => ({ ...errors, store: undefined }));
            }}
            ariaDescribedBy={
              fieldErrors.store ? `${storeHintId} ${storeErrorId}` : storeHintId
            }
            ariaInvalid={fieldErrors.store ? true : undefined}
            className="min-h-[48px] w-full"
          />
          <p id={storeHintId} className="mt-1 text-sm text-muted-foreground">
            {t("storeHint")}
          </p>
          {fieldErrors.store ? (
            <p
              id={storeErrorId}
              className="mt-1 text-sm font-medium text-danger-foreground"
            >
              {fieldErrors.store}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor={priceId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("priceLabel")}
          </label>
          <Input
            id={priceId}
            name="price"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={price}
            onChange={(event) => {
              setPrice(event.target.value);
              setFieldErrors((errors) => ({
                ...errors,
                price: undefined,
                store: undefined,
              }));
            }}
            aria-invalid={fieldErrors.price ? true : undefined}
            aria-describedby={
              fieldErrors.price ? `${priceHintId} ${priceErrorId}` : priceHintId
            }
          />
          <p id={priceHintId} className="mt-1 text-sm text-muted-foreground">
            {t("priceHint")}
          </p>
          {fieldErrors.price ? (
            <p
              id={priceErrorId}
              className="mt-1 text-sm font-medium text-danger-foreground"
            >
              {fieldErrors.price}
            </p>
          ) : null}
        </div>

        {/* The folded half (Phase 8 item 3): most saves are quantity, expiry
            and where it was bought — the unit is prefilled from the product,
            the location stays blank until chosen, and the note is
            rare. Native <details>, the pattern ProductRating set; controlled,
            so a refusal about the unit can open it rather than point at a
            closed drawer. */}
        <details
          className="rounded border border-border bg-muted"
          ref={advancedRef}
        >
          <summary className="flex min-h-[48px] cursor-pointer items-center px-4 font-medium text-foreground">
            {t("advancedSummary")}
          </summary>
          <div className="space-y-6 px-4 pb-4">
            <div>
              <label
                htmlFor={unitId}
                className="mb-1 block text-sm font-medium text-foreground"
              >
                {t("unitLabel")}
              </label>
              <Input
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
                onChange={(selected) => {
                  setLocationId(selected);
                }}
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
              <Textarea
                id={noteId}
                name="note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("notePlaceholder")}
                aria-describedby={noteHintId}
                // `Input` is an `<input>`; a note is a `<textarea>` and has
                // no primitive. The classes are `Input`'s, written out, which
                // is the one place in this file that is still true.
              />
              <p id={noteHintId} className="mt-1 text-sm text-muted-foreground">
                {t("noteHint")}
              </p>
            </div>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={addStock.isPending}
          >
            {t("submit")}
          </Button>
          <Button asChild variant="outline">
            <Link href="/inventory">{t("cancel")}</Link>
          </Button>
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
