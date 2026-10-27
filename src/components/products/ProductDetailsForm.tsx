"use client";

import { useDeferredValue, useId, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Input } from "@/components/ui/input";
import { useSnackbar } from "@/components/ui/snackbar";
import { api } from "@/lib/trpc/client";
import { useQuantityFormat } from "@/lib/inventory/quantity";

import type { JSX } from "react";

/**
 * The catalogue fields, read and written in the same place.
 *
 * They used to be a read-only list here and a form on a route of its own, so
 * correcting a typo meant leaving the product, losing every other thing the
 * page was showing, and coming back. Two screens for one record, and the
 * second one existed only because the first refused to be edited.
 *
 * D92 says a page owns its form, and this respects it: the form lives beside
 * the only page that uses it and is not shared with anything. It is a separate
 * file because the product page is already six hundred lines, not because the
 * form is a component two screens draw.
 *
 * Editing is a mode with an explicit Guardar and Descartar rather than fields
 * that save as you leave them. A catalogue row is read far more often than it
 * is changed, and a screen whose values are always inputs invites a change
 * nobody meant — particularly on the tier where a scroll can land on a select.
 */
export interface EditableProduct {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  barcode: string | null;
  defaultUnit: string;
  minStock: number | null;
  createdAt: Date;
}

interface FieldErrors {
  name?: string;
  unit?: string;
  minStock?: string;
  barcode?: string;
}

/** Turns a tRPC error into something a person can act on. */
function serverErrorKey(message: string | undefined): string {
  const normalized = message?.toLowerCase() ?? "";

  if (normalized.includes("unique constraint"))
    return "errorBarcodeTakenServer";
  if (normalized.includes("product not found")) return "errorNotFound";
  if (normalized.includes("household")) return "errorNoHousehold";

  return "errorGeneric";
}

export function ProductDetailsForm({
  product,
  canEdit,
  formattedDate,
}: {
  product: EditableProduct;
  /** Courtesy only. `writeProcedure` is the control (D90's shape). */
  canEdit: boolean;
  formattedDate: string;
}): JSX.Element {
  const tDetail = useTranslations("products.detail");
  const units = useQuantityFormat();

  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-heading text-lg">
          {tDetail("detailsTitle")}
        </h2>
        {canEdit && !editing ? (
          <Button
            onClick={() => setEditing(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            {tDetail("editFields")}
          </Button>
        ) : null}
      </div>

      {editing ? (
        // Keyed on the product so a refetch that changes it underneath starts
        // the form again rather than leaving half-edited values from a row
        // that no longer says that.
        <Fields
          key={product.id}
          onDone={() => setEditing(false)}
          product={product}
        />
      ) : (
        <dl className="mt-2 space-y-3">
          <Row
            label={tDetail("brandLabel")}
            value={product.brand || tDetail("notSet")}
          />
          <Row
            label={tDetail("categoryLabel")}
            value={product.category || tDetail("notSet")}
          />
          <Row
            label={tDetail("barcodeLabel")}
            mono
            value={product.barcode || tDetail("notSet")}
          />
          <Row
            label={tDetail("unitLabel")}
            value={units.unit(product.defaultUnit, 1)}
          />
          <Row
            label={tDetail("minStockLabel")}
            value={
              product.minStock === null
                ? tDetail("minStockNone")
                : units.quantity(product.minStock, product.defaultUnit)
            }
          />
          <Row label={tDetail("addedLabel")} value={formattedDate} />
        </dl>
      )}
    </>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div>
      <dt className="font-medium text-muted-foreground text-sm">{label}</dt>
      <dd className={mono ? "font-mono text-foreground" : "text-foreground"}>
        {value}
      </dd>
    </div>
  );
}

function Fields({
  product,
  onDone,
}: {
  product: EditableProduct;
  onDone: () => void;
}): JSX.Element {
  // Its own hooks rather than props. Two translators sharing the name `t` in
  // one file makes `message-usage.test.ts` attribute every key to whichever
  // namespace it saw last, and it silently checked six `products.edit` keys
  // against `products.detail`.
  const t = useTranslations("products.edit");
  const tDetail = useTranslations("products.detail");
  const tSuggestions = useTranslations("products.suggestions");
  const snackbar = useSnackbar();
  const utils = api.useUtils();
  // What the household has used before, offered in the three fields people
  // invent values for. The new-product form says why it is only a suggestion.
  const suggestions = api.product.suggestions.useQuery();
  const [name, setName] = useState(product.name);
  const [brand, setBrand] = useState(product.brand ?? "");
  const [category, setCategory] = useState(product.category ?? "");
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [unit, setUnit] = useState(product.defaultUnit);
  const [minStock, setMinStock] = useState(
    product.minStock === null ? "" : String(product.minStock),
  );

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [errorSignal, setErrorSignal] = useState(0);

  const nameId = useId();
  const brandId = useId();
  const categoryId = useId();
  const barcodeId = useId();
  const unitId = useId();
  const minStockId = useId();

  const trimmedBarcode = barcode.trim();
  // Keeps typing responsive: the duplicate check re-runs against the settled
  // value rather than firing once per keystroke.
  const settledBarcode = useDeferredValue(trimmedBarcode);
  const duplicate = api.product.getByBarcode.useQuery(
    { barcode: settledBarcode },
    { enabled: settledBarcode !== "" },
  );
  // A product's own barcode is not a clash. `getByBarcode` finds *this* one
  // when the code has not been touched, and calling that a collision would
  // make every edit look like one.
  const holder =
    settledBarcode !== "" && settledBarcode === trimmedBarcode
      ? (duplicate.data ?? null)
      : null;
  const takenBy = holder && holder.id !== product.id ? holder : null;

  /** The row as it was, so undo restores rather than compensates. */
  const previous = {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    barcode: product.barcode,
    defaultUnit: product.defaultUnit,
    minStock: product.minStock,
  };

  /**
   * The same procedure, reported differently.
   *
   * Restoring is not a save: it produces no further undo — there is nothing
   * left to take back that the reader did not already ask for — and its
   * failure belongs in the snackbar, because the form it came from is gone.
   */
  const undoUpdate = api.product.update.useMutation({
    onSuccess: async (restored) => {
      await utils.product.getById.invalidate({ id: product.id });
      await utils.product.list.invalidate();
      await utils.product.getByBarcode.invalidate();
      await utils.product.suggestions.invalidate();

      snackbar.show({
        kind: "confirm",
        message: {
          key: "products.edit.undone",
          values: { name: restored.name },
        },
      });
    },
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: {
          key: "products.edit.undoFailed",
          values: { name: product.name },
        },
      }),
  });

  const update = api.product.update.useMutation({
    onSuccess: async (updated) => {
      onDone();
      await utils.product.getById.invalidate({ id: product.id });
      await utils.product.list.invalidate();
      await utils.product.getByBarcode.invalidate();
      await utils.product.suggestions.invalidate();

      snackbar.show({
        kind: "undo-inverse",
        message: {
          key: "products.edit.saved",
          values: { name: updated.name },
        },
        // An exact inverse exists here and nowhere near stock: the row's
        // previous values are still in hand, so undo restores them rather
        // than writing a compensating anything (D101).
        //
        // Its own mutation, not this one. Sending the restore through
        // `update` re-entered this `onSuccess`, so undoing produced a second
        // snackbar offering to undo *that* — and by then `previous` had been
        // refetched to the values just restored, so pressing it did nothing
        // at all. A failed restore was worse: it wrote its message into a
        // form `onDone()` had already closed, where nobody could read it.
        undo: () => undoUpdate.mutate(previous),
      });
    },
    onError: (error) => {
      setServerError(t(serverErrorKey(error.message)));
      setErrorSignal((signal) => signal + 1);
    },
  });

  const summaryMessages = [
    fieldErrors.name,
    fieldErrors.unit,
    fieldErrors.minStock,
    fieldErrors.barcode,
    serverError,
  ].filter((message): message is string => Boolean(message));

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();

    const errors: FieldErrors = {};
    if (name.trim() === "") errors.name = t("errorNameRequired");
    if (unit.trim() === "") errors.unit = t("errorUnitRequired");

    let parsedMinStock: number | null = null;
    if (minStock.trim() !== "") {
      const parsed = Number(minStock);
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.minStock = t("errorMinStockInvalid");
      } else {
        parsedMinStock = parsed;
      }
    }
    if (takenBy) {
      errors.barcode = t("errorBarcodeTaken", { name: takenBy.name });
    }

    setServerError(null);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setErrorSignal((signal) => signal + 1);
      return;
    }

    update.mutate({
      id: product.id,
      name: name.trim(),
      defaultUnit: unit.trim(),
      barcode: trimmedBarcode !== "" ? trimmedBarcode : null,
      brand: brand.trim() !== "" ? brand.trim() : null,
      category: category.trim() !== "" ? category.trim() : null,
      minStock: parsedMinStock,
    });
  }

  return (
    <form className="mt-2 space-y-4" onSubmit={handleSubmit}>
      <FormErrorSummary
        focusSignal={errorSignal}
        messages={summaryMessages}
        title={t("errorTitle")}
      />

      <Field id={nameId} label={t("nameLabel")}>
        <Input
          id={nameId}
          onChange={(e) => setName(e.target.value)}
          value={name}
        />
      </Field>
      <Field id={brandId} label={t("brandLabel")}>
        <Combobox
          id={brandId}
          listLabel={tSuggestions("brands")}
          onValueChange={setBrand}
          options={suggestions.data?.brands ?? []}
          value={brand}
        />
      </Field>
      <Field id={categoryId} label={t("categoryLabel")}>
        <Combobox
          id={categoryId}
          listLabel={tSuggestions("categories")}
          onValueChange={setCategory}
          options={suggestions.data?.categories ?? []}
          value={category}
        />
      </Field>
      <Field id={barcodeId} label={t("barcodeLabel")}>
        <Input
          id={barcodeId}
          inputMode="numeric"
          onChange={(e) => setBarcode(e.target.value)}
          value={barcode}
        />
        {/* Always mounted, empty when silent. */}
        <p
          aria-live="polite"
          className="mt-1 font-medium text-danger-foreground text-sm"
          role="status"
        >
          {takenBy ? t("barcodeTakenBy", { name: takenBy.name }) : ""}
        </p>
      </Field>
      <Field id={unitId} label={t("unitLabel")}>
        <Combobox
          id={unitId}
          listLabel={tSuggestions("units")}
          onValueChange={setUnit}
          options={suggestions.data?.units ?? []}
          value={unit}
        />
      </Field>
      <Field id={minStockId} label={t("minStockLabel")}>
        <Input
          id={minStockId}
          inputMode="decimal"
          min="0"
          onChange={(e) => setMinStock(e.target.value)}
          // "any" rather than a step: a minimum of 2 with step=0.1 is a step
          // mismatch under exact arithmetic, and a form that fails constraint
          // validation does not submit and does not say why.
          step="any"
          type="number"
          value={minStock}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button disabled={update.isPending} type="submit">
          {t("submit")}
        </Button>
        <Button onClick={onDone} type="button" variant="outline">
          {tDetail("discardChanges")}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <label
        className="mb-1 block font-medium text-foreground text-sm"
        htmlFor={id}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
