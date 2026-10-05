"use client";

import Link from "next/link";
import { BackLink } from "@/components/ui/back-link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { LocationPicker } from "@/components/inventory/LocationPicker";
import { ProductPicker } from "@/components/inventory/ProductPicker";
import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/trpc/client";
import { useEnvelope } from "@/components/offline/Composer";
import type { PickedProduct } from "@/components/inventory/ProductPicker";
import type { FormEvent, JSX } from "react";

type FieldName = "product" | "quantity" | "unit";

type FieldErrors = Partial<Record<FieldName, string>>;

/**
 * Turns a tRPC error into something a person can act on.
 *
 * The procedures throw plain English `Error`s, so there is no error code to
 * switch on. Matching on the message is fragile, which is why anything
 * unrecognised falls back to a generic, still-actionable message rather than
 * showing the raw text.
 *
 * `consumeStock` throws one message `addStock` cannot: "Not enough stock
 * available", when the amount asked for exceeds what the household holds. By
 * the time the server says so the form has already been checked against the
 * quantity on screen, so reaching this branch means the stock moved underneath
 * us — the translation says exactly that.
 */
function serverErrorKey(message: string | undefined): string {
  const normalized = message?.toLowerCase() ?? "";

  if (normalized.includes("not enough stock")) return "errorNotEnoughStockServer";
  if (normalized.includes("product not found")) return "errorProductNotFound";
  if (normalized.includes("unit cannot be converted")) return "errorUnitMismatch";
  if (normalized.includes("household")) return "errorNoHousehold";

  return "errorGeneric";
}

export default function ConsumeStockPage(): JSX.Element {
  const t = useTranslations("inventory.consume");
  const envelope = useEnvelope();
  const router = useRouter();
  const utils = api.useUtils();

  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  // True once the person edits the unit themselves, after which selecting a
  // different product must not overwrite what they typed.
  const [unitTouched, setUnitTouched] = useState(false);
  const [locationId, setLocationId] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  // The folded half — same contract and same hydration reasoning as
  // /inventory/add: uncontrolled, opened imperatively on a unit error.
  const advancedRef = useRef<HTMLDetailsElement | null>(null);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  // Bumped on every failed submit so the summary is re-focused each time, even
  // when the same errors come back twice in a row.
  const [errorSignal, setErrorSignal] = useState(0);
  const [saved, setSaved] = useState<{
    name: string;
    quantity: number;
    unit: string;
    left: number;
  } | null>(null);

  const availableId = useId();
  const quantityId = useId();
  const quantityHintId = useId();
  const quantityErrorId = useId();
  const unitId = useId();
  const unitHintId = useId();
  const unitErrorId = useId();
  const locationLabelId = useId();
  const noteId = useId();
  const noteHintId = useId();

  // What is in stock right now, so nobody has to guess before typing a number.
  // `ProductPicker` hands back only identity and unit, so the figure is fetched
  // here: `getById` returns the same net `totalStock` field `product.list`
  // exposes, but for exactly the chosen product rather than whichever page of
  // the catalogue the picker happens to be showing.
  const availability = api.product.getById.useQuery(
    { id: product?.id ?? "" },
    { enabled: Boolean(product) },
  );

  const availableStock = product ? availability.data?.totalStock : undefined;

  const availableMessage = !product
    ? t("availableNoProduct")
    : availability.isPending
      ? t("availableLoading")
      : availableStock === undefined
        ? t("availableUnknown")
        : t("availableValue", {
            quantity: availableStock,
            unit: product.defaultUnit,
          });

  const consumeStock = api.inventory.consumeStock.useMutation({
    /**
     * Report what was written, rather than redirecting in silence.
     *
     * The redirect's only confirmation was Next's route announcer reading
     * "Inventario", which is what it reads when somebody navigates there and
     * saves nothing — it answers "where am I", never "did that work"
     * (ISSUES.md A11Y-1). Saying it here also answers *how much is left*,
     * which is the question somebody consuming stock actually has next.
     */
    onSuccess: async (_data, variables) => {
      const used = Math.abs(variables.quantity);
      setSaved({
        name: product?.name ?? "",
        quantity: used,
        unit: variables.unit,
        left: Math.round(((availableStock ?? used) - used) * 100) / 100,
      });
      await utils.inventory.getStockOverview.invalidate();
      // The figure above is read from this query, and consuming twice in a row
      // is an ordinary thing to do, so it must not be served from cache.
      await utils.product.getById.invalidate({ id: variables.productId });
      router.refresh();
    },
    onError: (error) => {
      const key = serverErrorKey(error.message);
      setServerError(t(key, { unit: product?.defaultUnit ?? "" }));
      if (key === "errorUnitMismatch") advancedRef.current?.setAttribute("open", "");
      setErrorSignal((signal) => signal + 1);
    },
  });

  const summaryMessages = [
    fieldErrors.product,
    fieldErrors.quantity,
    fieldErrors.unit,
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
    const quantityIsValid =
      quantity.trim() !== "" &&
      Number.isFinite(parsedQuantity) &&
      parsedQuantity > 0;

    if (!quantityIsValid) {
      errors.quantity = t("errorQuantityRequired");
    } else if (
      product &&
      availableStock !== undefined &&
      parsedQuantity > availableStock
    ) {
      // Caught here as well as on the server so the number can be named. The
      // server check is the one that counts; this one only saves a round trip
      // and lets the message say how much there actually is.
      errors.quantity = t("errorNotEnoughStock", {
        available: availableStock,
        unit: product.defaultUnit,
      });
    }

    if (unit.trim() === "") {
      errors.unit = t("errorUnitRequired");
    }

    setServerError(null);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0 || !product) {
      if (errors.unit) advancedRef.current?.setAttribute("open", "");
      setErrorSignal((signal) => signal + 1);
      return;
    }

    consumeStock.mutate({
      ...envelope(),
      productId: product.id,
      quantity: parsedQuantity,
      unit: unit.trim(),
      // Deliberately sent as `locationId` and not `consumeFromLocationId`.
      // `consumeFromLocationId` narrows the server's availability check to that
      // one location, which would contradict the household-wide figure shown
      // above. The entry is still filed against the chosen location either way.
      ...(locationId ? { locationId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Over the form rather than instead of it — see the note on the same
          dialog in inventory/add. Closing it is what "Apuntar otro consumo"
          used to be. */}
      <Dialog
        description={
          saved
            ? t("successBody", {
                quantity: saved.quantity,
                unit: saved.unit,
                name: saved.name,
                left: saved.left,
              })
            : undefined
        }
        footer={
          <>
            <Button asChild variant="outline">
              <Link href="/inventory">{t("successViewInventory")}</Link>
            </Button>
            <Button onClick={() => setSaved(null)} type="button">
              {t("successConsumeMore")}
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

        <div className="rounded border border-border bg-muted p-4">
          <h2 className="text-sm font-medium text-foreground">
            {t("availableLabel")}
          </h2>
          {/* Kept mounted so the figure is announced when the product changes,
              rather than the whole region arriving at once. */}
          <p
            id={availableId}
            role="status"
            aria-live="polite"
            className="mt-1 text-lg font-semibold text-foreground"
          >
            {availableMessage}
          </p>
        </div>

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
                ? `${availableId} ${quantityHintId} ${quantityErrorId}`
                : `${availableId} ${quantityHintId}`
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

        {/* The folded half (Phase 8 item 3): consuming is picking the product
            and saying how much — the unit is prefilled and the rest is rare.
            Same controlled-<details> shape as /inventory/add. */}
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
              <Textarea
                id={noteId}
                name="note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("notePlaceholder")}
                aria-describedby={noteHintId}
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
            disabled={consumeStock.isPending}
          >
            {t("submit")}
          </Button>
          <Button asChild variant="outline">
            <Link href="/inventory" > {t("cancel")} </Link>
          </Button>
          {/* Kept mounted so the message is announced when it appears, rather
              than the whole region arriving at once. */}
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {consumeStock.isPending ? t("submitting") : ""}
          </p>
        </div>
      </form>
    </div>
  );
}
