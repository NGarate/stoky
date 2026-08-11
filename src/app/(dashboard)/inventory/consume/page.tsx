"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { LocationPicker } from "@/components/inventory/LocationPicker";
import { ProductPicker } from "@/components/inventory/ProductPicker";
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

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  // Bumped on every failed submit so the summary is re-focused each time, even
  // when the same errors come back twice in a row.
  const [errorSignal, setErrorSignal] = useState(0);

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

  const summaryRef = useRef<HTMLDivElement | null>(null);

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
    onSuccess: async (_data, variables) => {
      await utils.inventory.getStockOverview.invalidate();
      // The figure above is read from this query, and consuming twice in a row
      // is an ordinary thing to do, so it must not be served from cache.
      await utils.product.getById.invalidate({ id: variables.productId });
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
      setErrorSignal((signal) => signal + 1);
      return;
    }

    consumeStock.mutate({
      ...envelope(),
      productId: product.id,
      quantity: parsedQuantity,
      unit: unit.trim(),
      // Required by the input schema, then ignored by the procedure, which
      // always writes CONSUME. Sent so the Zod input validates.
      operationType: "CONSUME",
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
                ? `${availableId} ${quantityHintId} ${quantityErrorId}`
                : `${availableId} ${quantityHintId}`
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
            disabled={consumeStock.isPending}
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
            {consumeStock.isPending ? t("submitting") : ""}
          </p>
        </div>
      </form>
    </div>
  );
}
