"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Suspense,
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/trpc/client";
import type { FormEvent, JSX } from "react";

type FieldName = "name" | "barcode" | "unit" | "minStock";

type FieldErrors = Partial<Record<FieldName, string>>;

/** What the form was able to create, and how. Set once, then the form is replaced. */
interface CreatedProduct {
  name: string;
  /** True when Open Food Facts, not the form, supplied the data. */
  fromLookup: boolean;
}

/**
 * Turns a tRPC error into something a person can act on.
 *
 * The procedures throw plain English `Error`s, so there is no error code to
 * switch on. Matching on the message is fragile, which is why anything
 * unrecognised falls back to a generic, still-actionable message rather than
 * showing the raw text.
 *
 * `product.create` calls `prisma.product.create` with no pre-check, so a barcode
 * that already belongs to another product in the household surfaces as a raw
 * Prisma unique-constraint violation on `[barcode, householdId]`. The form
 * checks for that before submitting, so reaching this branch means the other
 * product appeared while this one was being filled in.
 */
function serverErrorKey(message: string | undefined): string {
  const normalized = message?.toLowerCase() ?? "";

  if (normalized.includes("unique constraint")) return "errorBarcodeTakenServer";
  if (normalized.includes("household")) return "errorNoHousehold";

  return "errorGeneric";
}

/**
 * `useSearchParams` opts the subtree out of static rendering, so it has to sit
 * under a Suspense boundary or the build fails. The boundary is here rather
 * than around a fragment of the form so the whole page has one loading state.
 */
export default function NewProductPage(): JSX.Element {
  return (
    <Suspense fallback={<NewProductFallback />}>
      <NewProductForm />
    </Suspense>
  );
}

function NewProductFallback(): JSX.Element {
  const t = useTranslations("products.new");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-2 text-2xl font-bold">{t("title")}</h1>
      <p role="status" aria-live="polite" className="mt-2 text-gray-700">
        {t("loading")}
      </p>
    </div>
  );
}

function NewProductForm(): JSX.Element {
  const t = useTranslations("products.new");
  const searchParams = useSearchParams();
  const utils = api.useUtils();

  const scannedBarcode = searchParams.get("barcode")?.trim() ?? "";

  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState(scannedBarcode);
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  // Mirrors the Zod default, so leaving it alone stores exactly what the schema
  // would have stored anyway.
  const [unit, setUnit] = useState("unit");
  const [minStock, setMinStock] = useState("");
  // Held separately from the query parameter so "create another" can clear the
  // scanned-code panel without the URL contradicting the empty form.
  const [showScanContext, setShowScanContext] = useState(scannedBarcode !== "");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  // Bumped on every failed submit so the summary is re-focused each time, even
  // when the same errors come back twice in a row.
  const [errorSignal, setErrorSignal] = useState(0);
  const [lookupOutcome, setLookupOutcome] = useState<
    "notFound" | "failed" | null
  >(null);
  const [created, setCreated] = useState<CreatedProduct | null>(null);

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
  const lookupHintId = useId();
  const lookupStatusId = useId();

  const summaryRef = useRef<HTMLDivElement | null>(null);
  const successRef = useRef<HTMLDivElement | null>(null);

  const trimmedBarcode = barcode.trim();
  // Keeps typing responsive: the duplicate check re-runs against the settled
  // value rather than firing once per keystroke.
  const settledBarcode = useDeferredValue(trimmedBarcode);

  // The unique constraint is on `[barcode, householdId]`, so a code already used
  // in this household is a guaranteed failure. Caught here so the message can
  // name the product that holds it, rather than surfacing a Prisma error.
  const duplicate = api.product.getByBarcode.useQuery(
    { barcode: settledBarcode },
    { enabled: settledBarcode !== "" },
  );

  const takenBy =
    settledBarcode !== "" && settledBarcode === trimmedBarcode
      ? (duplicate.data ?? null)
      : null;

  /**
   * Open Food Facts enrichment.
   *
   * `scanBarcode` is the only procedure that reaches Open Food Facts, and when
   * the catalogue knows a code it writes the product itself rather than handing
   * back fields to prefill. So this button either finishes the job or leaves the
   * form exactly as it was — it never blocks it. Arriving here from the scanner
   * already means one lookup came back empty; pressing it is a deliberate retry,
   * which is worth offering because a network failure and a genuine "not in the
   * catalogue" are indistinguishable to the caller.
   */
  const lookup = api.product.scanBarcode.useMutation({
    onSuccess: async (result) => {
      if (!result.product) {
        setLookupOutcome("notFound");
        return;
      }

      if (result.source === "local") {
        // Someone in the household already has this code. Nothing was created.
        setLookupOutcome(null);
        await utils.product.getByBarcode.invalidate();
        setFieldErrors((errors) => ({
          ...errors,
          barcode: t("errorBarcodeTaken", { name: result.product.name }),
        }));
        setErrorSignal((signal) => signal + 1);
        return;
      }

      setLookupOutcome(null);
      await utils.product.list.invalidate();
      await utils.product.getByBarcode.invalidate();
      setCreated({ name: result.product.name, fromLookup: true });
    },
    onError: () => {
      setLookupOutcome("failed");
    },
  });

  const createProduct = api.product.create.useMutation({
    onSuccess: async (product) => {
      await utils.product.list.invalidate();
      await utils.product.getByBarcode.invalidate();
      setCreated({ name: product.name, fromLookup: false });
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

  const lookupMessage = lookup.isPending
    ? t("lookupPending")
    : lookupOutcome === "notFound"
      ? t("lookupNotFound")
      : lookupOutcome === "failed"
        ? t("lookupFailed")
        : "";

  useEffect(() => {
    if (errorSignal > 0) {
      summaryRef.current?.focus();
    }
  }, [errorSignal]);

  useEffect(() => {
    if (created) {
      successRef.current?.focus();
    }
  }, [created]);

  function handleLookup(): void {
    if (trimmedBarcode === "") return;

    setLookupOutcome(null);
    setServerError(null);
    lookup.mutate({ barcode: trimmedBarcode });
  }

  function handleCreateAnother(): void {
    setCreated(null);
    setName("");
    setBarcode("");
    setBrand("");
    setCategory("");
    setUnit("unit");
    setMinStock("");
    setShowScanContext(false);
    setFieldErrors({});
    setServerError(null);
    setLookupOutcome(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const errors: FieldErrors = {};

    if (name.trim() === "") {
      errors.name = t("errorNameRequired");
    }

    if (trimmedBarcode !== "" && takenBy) {
      errors.barcode = t("errorBarcodeTaken", { name: takenBy.name });
    }

    if (unit.trim() === "") {
      errors.unit = t("errorUnitRequired");
    }

    let parsedMinStock: number | undefined;
    if (minStock.trim() !== "") {
      const parsed = Number(minStock);
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.minStock = t("errorMinStockInvalid");
      } else {
        parsedMinStock = parsed;
      }
    }

    setServerError(null);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setErrorSignal((signal) => signal + 1);
      return;
    }

    createProduct.mutate({
      name: name.trim(),
      defaultUnit: unit.trim(),
      // Sent only when filled in. An empty string is not the same as absent
      // here: `barcode` is part of a unique index, so storing "" would let the
      // first product without a code claim it and every later one collide.
      ...(trimmedBarcode ? { barcode: trimmedBarcode } : {}),
      ...(brand.trim() ? { brand: brand.trim() } : {}),
      ...(category.trim() ? { category: category.trim() } : {}),
      ...(parsedMinStock !== undefined ? { minStock: parsedMinStock } : {}),
    });
  }

  if (created) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link
          href="/products"
          className="inline-flex min-h-[44px] items-center text-blue-700 underline"
        >
          {t("backToProducts")}
        </Link>

        <div
          ref={successRef}
          role="status"
          tabIndex={-1}
          className="mt-2 rounded border border-green-700 bg-green-50 p-4 text-green-900"
        >
          <h1 className="text-2xl font-bold">{t("successTitle")}</h1>
          <p className="mt-2">
            {created.fromLookup
              ? t("successCreatedFromLookup", { name: created.name })
              : t("successCreated", { name: created.name })}
          </p>
        </div>

        <h2 className="mt-6 text-lg font-semibold">{t("successNextTitle")}</h2>
        <ul className="mt-2 space-y-2">
          <li>
            <Link
              href="/products"
              className="inline-flex min-h-[44px] items-center text-blue-700 underline"
            >
              {t("successViewProducts")}
            </Link>
          </li>
          <li>
            <Link
              href="/inventory/add"
              className="inline-flex min-h-[44px] items-center text-blue-700 underline"
            >
              {t("successAddStock")}
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={handleCreateAnother}
              className="min-h-[44px] text-blue-700 underline"
            >
              {t("successCreateAnother")}
            </button>
          </li>
        </ul>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/products"
        className="inline-flex min-h-[44px] items-center text-blue-700 underline"
      >
        {t("backToProducts")}
      </Link>

      <h1 className="mt-2 text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-gray-700">{t("intro")}</p>

      {showScanContext ? (
        <div className="mt-4 rounded border border-blue-700 bg-blue-50 p-4">
          <h2 className="text-sm font-medium text-blue-950">
            {t("scanContextTitle")}
          </h2>
          <p className="mt-1 font-mono text-lg font-semibold text-blue-950">
            {scannedBarcode}
          </p>
          <p className="mt-1 text-sm text-blue-950">{t("scanContextIntro")}</p>
        </div>
      ) : null}

      <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-6">
        {summaryMessages.length > 0 ? (
          <div
            ref={summaryRef}
            role="alert"
            tabIndex={-1}
            className="rounded border border-red-700 bg-red-50 p-4 text-red-900"
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
            className="mb-1 block text-sm font-medium text-gray-900"
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
            className="min-h-[44px] w-full rounded border border-gray-400 bg-white px-3 py-2"
          />
          <p id={nameHintId} className="mt-1 text-sm text-gray-700">
            {t("nameHint")}
          </p>
          {fieldErrors.name ? (
            <p id={nameErrorId} className="mt-1 text-sm font-medium text-red-800">
              {fieldErrors.name}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor={barcodeId}
            className="mb-1 block text-sm font-medium text-gray-900"
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
              setLookupOutcome(null);
              setFieldErrors((errors) => ({ ...errors, barcode: undefined }));
            }}
            aria-invalid={fieldErrors.barcode || takenBy ? true : undefined}
            aria-describedby={
              fieldErrors.barcode
                ? `${barcodeHintId} ${barcodeTakenId} ${barcodeErrorId}`
                : `${barcodeHintId} ${barcodeTakenId}`
            }
            className="min-h-[44px] w-full rounded border border-gray-400 bg-white px-3 py-2"
          />
          <p id={barcodeHintId} className="mt-1 text-sm text-gray-700">
            {t("barcodeHint")}
          </p>
          {/* Kept mounted so the clash is announced the moment the lookup comes
              back, rather than the whole region arriving at once. */}
          <p
            id={barcodeTakenId}
            role="status"
            aria-live="polite"
            className="mt-1 text-sm font-medium text-red-800"
          >
            {takenBy ? t("barcodeTakenBy", { name: takenBy.name }) : ""}
          </p>
          {fieldErrors.barcode ? (
            <p
              id={barcodeErrorId}
              className="mt-1 text-sm font-medium text-red-800"
            >
              {fieldErrors.barcode}
            </p>
          ) : null}
        </div>

        <div className="rounded border border-gray-300 bg-gray-50 p-4">
          <h2 className="text-sm font-medium text-gray-900">
            {t("lookupTitle")}
          </h2>
          <p id={lookupHintId} className="mt-1 text-sm text-gray-700">
            {t("lookupHint")}
          </p>
          <button
            type="button"
            onClick={handleLookup}
            disabled={trimmedBarcode === "" || lookup.isPending}
            aria-describedby={`${lookupHintId} ${lookupStatusId}`}
            className="mt-3 min-h-[44px] rounded border border-gray-500 bg-white px-4 py-2 font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-60"
          >
            {t("lookupButton")}
          </button>
          {/* Kept mounted so the outcome is announced when it arrives, rather
              than the whole region arriving at once. */}
          <p
            id={lookupStatusId}
            role="status"
            aria-live="polite"
            className="mt-2 text-sm text-gray-700"
          >
            {lookupMessage}
          </p>
        </div>

        <div>
          <label
            htmlFor={brandId}
            className="mb-1 block text-sm font-medium text-gray-900"
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
            className="min-h-[44px] w-full rounded border border-gray-400 bg-white px-3 py-2"
          />
          <p id={brandHintId} className="mt-1 text-sm text-gray-700">
            {t("brandHint")}
          </p>
        </div>

        <div>
          <label
            htmlFor={categoryId}
            className="mb-1 block text-sm font-medium text-gray-900"
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
            className="min-h-[44px] w-full rounded border border-gray-400 bg-white px-3 py-2"
          />
          <p id={categoryHintId} className="mt-1 text-sm text-gray-700">
            {t("categoryHint")}
          </p>
        </div>

        <div>
          <label
            htmlFor={unitId}
            className="mb-1 block text-sm font-medium text-gray-900"
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
            className="min-h-[44px] w-full rounded border border-gray-400 bg-white px-3 py-2"
          />
          <p id={unitHintId} className="mt-1 text-sm text-gray-700">
            {t("unitHint")}
          </p>
          {fieldErrors.unit ? (
            <p id={unitErrorId} className="mt-1 text-sm font-medium text-red-800">
              {fieldErrors.unit}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor={minStockId}
            className="mb-1 block text-sm font-medium text-gray-900"
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
            className="min-h-[44px] w-full rounded border border-gray-400 bg-white px-3 py-2"
          />
          <p id={minStockHintId} className="mt-1 text-sm text-gray-700">
            {t("minStockHint")}
          </p>
          {fieldErrors.minStock ? (
            <p
              id={minStockErrorId}
              className="mt-1 text-sm font-medium text-red-800"
            >
              {fieldErrors.minStock}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={createProduct.isPending}
            className="min-h-[44px] rounded bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800 disabled:opacity-60"
          >
            {t("submit")}
          </button>
          <Link
            href="/products"
            className="inline-flex min-h-[44px] items-center rounded border border-gray-400 px-4 py-2"
          >
            {t("cancel")}
          </Link>
          {/* Kept mounted so the message is announced when it appears, rather
              than the whole region arriving at once. */}
          <p role="status" aria-live="polite" className="text-sm text-gray-700">
            {createProduct.isPending ? t("submitting") : ""}
          </p>
        </div>
      </form>
    </div>
  );
}
