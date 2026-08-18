"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { use, useDeferredValue, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/trpc/client";
import type { FormEvent, JSX } from "react";

type FieldName = "name" | "barcode" | "unit" | "minStock";

type FieldErrors = Partial<Record<FieldName, string>>;

/**
 * Turns a tRPC error into something a person can act on.
 *
 * Same shape as the create form's, with one addition: `update` can also come
 * back with "Product not found" — the row went away, or the id belongs to
 * another household, and the server deliberately does not say which.
 */
function serverErrorKey(message: string | undefined): string {
  const normalized = message?.toLowerCase() ?? "";

  if (normalized.includes("unique constraint")) return "errorBarcodeTakenServer";
  if (normalized.includes("product not found")) return "errorNotFound";
  if (normalized.includes("household")) return "errorNoHousehold";

  return "errorGeneric";
}

interface ProductEditPageProps {
  params: Promise<{ id: string }>;
}

export default function ProductEditPage({
  params,
}: ProductEditPageProps): JSX.Element {
  const { id } = use(params);
  return <ProductEditView id={id} />;
}

/**
 * The screen, exported apart from the route so the component suite can render
 * it without a `params` promise — the route's only job is `use(params)`.
 *
 * The form's fields are the create form's six, minus its creation-only
 * machinery (the scan context, the Open Food Facts panel, the success screen).
 * Duplicating the field markup instead of extracting a shared component is a
 * recorded decision (PROGRESS D92): the create form hardcodes create-mode
 * behaviour throughout, and this codebase's idiom is that a page owns its form.
 *
 * Clearing: an optional field left blank is sent as `null`, which is the only
 * way to *remove* a value — `updateProductSchema` treats absence as "leave it
 * alone", and refuses `""` for the barcode outright (unique index).
 */
export function ProductEditView({ id }: { id: string }): JSX.Element {
  const t = useTranslations("products.edit");
  const utils = api.useUtils();

  // `retry: false` for the same reason the detail page gives: the likeliest
  // failure is an id that is not in this household's catalogue, and retrying
  // that three times only delays saying so.
  const query = api.product.getById.useQuery({ id }, { retry: false });
  const product = query.data;

  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("unit");
  const [minStock, setMinStock] = useState("");
  // The query answers after the first render, so the fields are seeded once
  // when it does — never again, or a background refetch would overwrite what
  // the person is typing.
  const [seeded, setSeeded] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  // Bumped on every failed submit so the summary is re-focused each time, even
  // when the same errors come back twice in a row.
  const [errorSignal, setErrorSignal] = useState(0);
  const [savedName, setSavedName] = useState<string | null>(null);

  const nameId = useId();
  const nameHintId = useId();
  const nameErrorId = useId();
  const barcodeId = useId();
  const barcodeHintId = useId();
  const barcodeTakenId = useId();
  const barcodeErrorId = useId();
  const brandId = useId();
  const brandHintId = useId();
  const categoryId = useId();
  const categoryHintId = useId();
  const unitId = useId();
  const unitHintId = useId();
  const unitErrorId = useId();
  const minStockId = useId();
  const minStockHintId = useId();
  const minStockErrorId = useId();

  const summaryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (product && !seeded) {
      setName(product.name);
      setBarcode(product.barcode ?? "");
      setBrand(product.brand ?? "");
      setCategory(product.category ?? "");
      setUnit(product.defaultUnit);
      setMinStock(product.minStock === null ? "" : String(product.minStock));
      setSeeded(true);
    }
  }, [product, seeded]);

  const trimmedBarcode = barcode.trim();
  // Keeps typing responsive: the duplicate check re-runs against the settled
  // value rather than firing once per keystroke.
  const settledBarcode = useDeferredValue(trimmedBarcode);

  const duplicate = api.product.getByBarcode.useQuery(
    { barcode: settledBarcode },
    { enabled: seeded && settledBarcode !== "" },
  );

  // The one difference from the create form's check: the product's own barcode
  // is not a clash. `getByBarcode` finds *this* product when the code has not
  // been touched, and telling someone their product already has its own code
  // would make every edit look like a collision.
  const holder =
    settledBarcode !== "" && settledBarcode === trimmedBarcode
      ? (duplicate.data ?? null)
      : null;
  const takenBy = holder && holder.id !== id ? holder : null;

  const updateProduct = api.product.update.useMutation({
    onSuccess: async (updated) => {
      setSavedName(updated.name);
      await utils.product.getById.invalidate({ id });
      await utils.product.list.invalidate();
      await utils.product.getByBarcode.invalidate();
    },
    onError: (error) => {
      setServerError(t(serverErrorKey(error.message)));
      setErrorSignal((signal) => signal + 1);
    },
  });

  const summaryMessages = [
    fieldErrors.name,
    fieldErrors.barcode,
    fieldErrors.unit,
    fieldErrors.minStock,
    serverError,
  ].filter((message): message is string => Boolean(message));

  useEffect(() => {
    if (errorSignal > 0) {
      summaryRef.current?.focus();
    }
  }, [errorSignal]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const errors: FieldErrors = {};

    if (name.trim() === "") {
      errors.name = t("errorNameRequired");
    }

    if (takenBy) {
      errors.barcode = t("errorBarcodeTaken", { name: takenBy.name });
    }

    if (unit.trim() === "") {
      errors.unit = t("errorUnitRequired");
    }

    let parsedMinStock: number | null = null;
    if (minStock.trim() !== "") {
      const parsed = Number(minStock);
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.minStock = t("errorMinStockInvalid");
      } else {
        parsedMinStock = parsed;
      }
    }

    setSavedName(null);
    setServerError(null);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setErrorSignal((signal) => signal + 1);
      return;
    }

    // Every field is sent, blanks as `null`: absence would mean "leave the old
    // value", and a person who emptied the box meant the opposite.
    updateProduct.mutate({
      id,
      name: name.trim(),
      defaultUnit: unit.trim(),
      barcode: trimmedBarcode !== "" ? trimmedBarcode : null,
      brand: brand.trim() !== "" ? brand.trim() : null,
      category: category.trim() !== "" ? category.trim() : null,
      minStock: parsedMinStock,
    });
  }

  if (query.error) {
    const errorKey = serverErrorKey(query.error.message);

    return (
      <div className="mx-auto max-w-2xl">
        <Link
          href="/products"
          className="inline-flex min-h-[48px] items-center text-primary underline"
        >
          {t("backToProduct")}
        </Link>

        <div
          role="alert"
          className="mt-2 rounded border border-danger-foreground bg-danger p-4 text-danger-foreground"
        >
          <h1 className="text-2xl font-bold">{t("errorTitle")}</h1>
          <p className="mt-2">{t(errorKey)}</p>
        </div>

        {/* Retrying a product that is not in the catalogue would fail the same
            way every time; a transport failure is the case worth offering. */}
        {errorKey === "errorNotFound" ? null : (
          <button
            type="button"
            onClick={() => {
              void query.refetch();
            }}
            className="mt-4 min-h-[48px] rounded border border-input bg-card px-4 py-2 font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {t("retry")}
          </button>
        )}
      </div>
    );
  }

  if (!product || !seeded) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mt-2 text-2xl font-bold text-heading">{t("title")}</h1>
        <p role="status" aria-live="polite" className="mt-2 text-muted-foreground">
          {t("loading")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/products/${id}`}
        className="inline-flex min-h-[48px] items-center text-primary underline"
      >
        {t("backToProduct")}
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

        <div>
          <label
            htmlFor={nameId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("nameLabel")}
          </label>
          <input
            id={nameId}
            name="name"
            type="text"
            required
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={
              fieldErrors.name ? `${nameHintId} ${nameErrorId}` : nameHintId
            }
            className="min-h-[48px] w-full rounded border border-input bg-card px-3 py-2 text-foreground"
          />
          <p id={nameHintId} className="mt-1 text-sm text-muted-foreground">
            {t("nameHint")}
          </p>
          {fieldErrors.name ? (
            <p id={nameErrorId} className="mt-1 text-sm font-medium text-danger-foreground">
              {fieldErrors.name}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor={barcodeId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("barcodeLabel")}
          </label>
          <input
            id={barcodeId}
            name="barcode"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={barcode}
            onChange={(event) => {
              setBarcode(event.target.value);
              setFieldErrors((errors) => ({ ...errors, barcode: undefined }));
            }}
            aria-invalid={fieldErrors.barcode || takenBy ? true : undefined}
            aria-describedby={
              fieldErrors.barcode
                ? `${barcodeHintId} ${barcodeTakenId} ${barcodeErrorId}`
                : `${barcodeHintId} ${barcodeTakenId}`
            }
            className="min-h-[48px] w-full rounded border border-input bg-card px-3 py-2 text-foreground"
          />
          <p id={barcodeHintId} className="mt-1 text-sm text-muted-foreground">
            {t("barcodeHint")}
          </p>
          {/* Kept mounted so the clash is announced the moment the lookup comes
              back, rather than the whole region arriving at once. */}
          <p
            id={barcodeTakenId}
            role="status"
            aria-live="polite"
            className="mt-1 text-sm font-medium text-danger-foreground"
          >
            {takenBy ? t("barcodeTakenBy", { name: takenBy.name }) : ""}
          </p>
          {fieldErrors.barcode ? (
            <p
              id={barcodeErrorId}
              className="mt-1 text-sm font-medium text-danger-foreground"
            >
              {fieldErrors.barcode}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor={brandId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("brandLabel")}
          </label>
          <input
            id={brandId}
            name="brand"
            type="text"
            autoComplete="off"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            aria-describedby={brandHintId}
            className="min-h-[48px] w-full rounded border border-input bg-card px-3 py-2 text-foreground"
          />
          <p id={brandHintId} className="mt-1 text-sm text-muted-foreground">
            {t("brandHint")}
          </p>
        </div>

        <div>
          <label
            htmlFor={categoryId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("categoryLabel")}
          </label>
          <input
            id={categoryId}
            name="category"
            type="text"
            autoComplete="off"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-describedby={categoryHintId}
            className="min-h-[48px] w-full rounded border border-input bg-card px-3 py-2 text-foreground"
          />
          <p id={categoryHintId} className="mt-1 text-sm text-muted-foreground">
            {t("categoryHint")}
          </p>
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
            name="defaultUnit"
            type="text"
            required
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
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
            htmlFor={minStockId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("minStockLabel")}
          </label>
          <input
            id={minStockId}
            name="minStock"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={minStock}
            onChange={(event) => setMinStock(event.target.value)}
            aria-invalid={fieldErrors.minStock ? true : undefined}
            aria-describedby={
              fieldErrors.minStock
                ? `${minStockHintId} ${minStockErrorId}`
                : minStockHintId
            }
            className="min-h-[48px] w-full rounded border border-input bg-card px-3 py-2 text-foreground"
          />
          <p id={minStockHintId} className="mt-1 text-sm text-muted-foreground">
            {t("minStockHint")}
          </p>
          {fieldErrors.minStock ? (
            <p
              id={minStockErrorId}
              className="mt-1 text-sm font-medium text-danger-foreground"
            >
              {fieldErrors.minStock}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={updateProduct.isPending}
            className="min-h-[48px] rounded bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {t("submit")}
          </button>
          <Link
            href={`/products/${id}`}
            className="inline-flex min-h-[48px] items-center rounded border border-input bg-card px-4 py-2 text-foreground hover:bg-muted"
          >
            {t("backToProduct")}
          </Link>
          {/* Kept mounted so both the progress note and the saved confirmation
              are announced when they appear (A11Y-1: a saved change must say
              so, not redirect into silence). */}
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {updateProduct.isPending
              ? t("submitting")
              : savedName
                ? t("saved", { name: savedName })
                : ""}
          </p>
        </div>
      </form>
    </div>
  );
}
