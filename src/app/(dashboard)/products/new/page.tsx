"use client";

import Link from "next/link";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useDeferredValue, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/trpc/client";
import { useWriteQueue } from "@/lib/offline/queue-context";
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

  if (normalized.includes("unique constraint"))
    return "errorBarcodeTakenServer";
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
    <PageShell width="form">
      <PageHeader
        back={{ href: "/products", label: t("backToProducts") }}
        title={t("title")}
      />
      <p role="status" aria-live="polite" className="text-muted-foreground">
        {t("loading")}
      </p>
    </PageShell>
  );
}

function NewProductForm(): JSX.Element {
  const t = useTranslations("products.new");
  const tSuggestions = useTranslations("products.suggestions");
  const searchParams = useSearchParams();
  const utils = api.useUtils();
  const { discard } = useWriteQueue();

  const scannedBarcode = searchParams.get("barcode")?.trim() ?? "";
  // The queued scan that sent the person here, if any (T7). Discarded once the
  // product is created, so the sync indicator's review question clears.
  const pendingScan = searchParams.get("pendingScan")?.trim() || null;

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

  // What the household has typed into these fields before. A suggestion, not
  // a rule: while it loads, or offline with nothing cached, the fields are
  // plain text fields and the form works the same.
  const suggestions = api.product.suggestions.useQuery();

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

      // Either way the product now exists, so the queued scan that sent the
      // person here has its answer. Only the create path discarded it, so a
      // lookup that found or made the product left the "needs a name"
      // question standing in the sync banner, for a product that had one.
      if (pendingScan) discard(pendingScan);

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
      await utils.product.suggestions.invalidate();
      // A scan queued offline (T7) that could not be resolved sent the person
      // here to name it. Now that it is named, drop the queued scan so the
      // sync indicator's review question clears — the product it was asking
      // for exists.
      if (pendingScan) discard(pendingScan);
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

  return (
    <PageShell width="form">
      {/* Over the form rather than instead of it — see the note on the same
          dialog in inventory/add. Closing it is `handleCreateAnother`, which
          clears the form the way the button under the old screen did. */}
      <Dialog
        description={
          created
            ? created.fromLookup
              ? t("successCreatedFromLookup", { name: created.name })
              : t("successCreated", { name: created.name })
            : undefined
        }
        footer={
          <>
            <Button asChild variant="outline">
              <Link href="/products">{t("successViewProducts")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/inventory/add">{t("successAddStock")}</Link>
            </Button>
            <Button onClick={handleCreateAnother} type="button">
              {t("successCreateAnother")}
            </Button>
          </>
        }
        onClose={handleCreateAnother}
        open={created !== null}
        title={t("successTitle")}
      />

      <PageHeader
        back={{ href: "/products", label: t("backToProducts") }}
        intro={t("intro")}
        title={t("title")}
      />

      {showScanContext ? (
        <div className="mb-6 rounded border border-border bg-muted p-4">
          <h2 className="text-sm font-medium text-foreground">
            {t("scanContextTitle")}
          </h2>
          <p className="mt-1 font-mono text-lg font-semibold text-foreground">
            {scannedBarcode}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("scanContextIntro")}
          </p>
        </div>
      ) : null}

      <form noValidate onSubmit={handleSubmit} className="space-y-6">
        <FormErrorSummary
          focusSignal={errorSignal}
          messages={summaryMessages}
          title={t("errorTitle")}
        />

        <div>
          <label
            htmlFor={nameId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("nameLabel")}
          </label>
          <Input
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
          />
          <p id={nameHintId} className="mt-1 text-sm text-muted-foreground">
            {t("nameHint")}
          </p>
          {fieldErrors.name ? (
            <p
              id={nameErrorId}
              className="mt-1 text-sm font-medium text-danger-foreground"
            >
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
          <Input
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

        <div className="rounded border border-border bg-muted p-4">
          <h2 className="text-sm font-medium text-foreground">
            {t("lookupTitle")}
          </h2>
          <p id={lookupHintId} className="mt-1 text-sm text-muted-foreground">
            {t("lookupHint")}
          </p>
          <Button
            type="button"
            onClick={handleLookup}
            disabled={trimmedBarcode === "" || lookup.isPending}
            aria-describedby={`${lookupHintId} ${lookupStatusId}`}
          >
            {t("lookupButton")}
          </Button>
          {/* Kept mounted so the outcome is announced when it arrives, rather
              than the whole region arriving at once. */}
          <p
            id={lookupStatusId}
            role="status"
            aria-live="polite"
            className="mt-2 text-sm text-muted-foreground"
          >
            {lookupMessage}
          </p>
        </div>

        <div>
          <label
            htmlFor={brandId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("brandLabel")}
          </label>
          <Combobox
            id={brandId}
            name="brand"
            listLabel={tSuggestions("brands")}
            options={suggestions.data?.brands ?? []}
            value={brand}
            onValueChange={setBrand}
            aria-describedby={brandHintId}
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
          <Combobox
            id={categoryId}
            name="category"
            listLabel={tSuggestions("categories")}
            options={suggestions.data?.categories ?? []}
            value={category}
            onValueChange={setCategory}
            aria-describedby={categoryHintId}
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
          <Combobox
            id={unitId}
            name="defaultUnit"
            required
            listLabel={tSuggestions("units")}
            options={suggestions.data?.units ?? []}
            value={unit}
            onValueChange={setUnit}
            aria-invalid={fieldErrors.unit ? true : undefined}
            aria-describedby={
              fieldErrors.unit ? `${unitHintId} ${unitErrorId}` : unitHintId
            }
          />
          <p id={unitHintId} className="mt-1 text-sm text-muted-foreground">
            {t("unitHint")}
          </p>
          {fieldErrors.unit ? (
            <p
              id={unitErrorId}
              className="mt-1 text-sm font-medium text-danger-foreground"
            >
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
          <Input
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
          <Button type="submit" disabled={createProduct.isPending}>
            {t("submit")}
          </Button>
          <Button asChild variant="outline">
            <Link href="/products"> {t("cancel")} </Link>
          </Button>
          {/* Kept mounted so the message is announced when it appears, rather
              than the whole region arriving at once. */}
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground"
          >
            {createProduct.isPending ? t("submitting") : ""}
          </p>
        </div>
      </form>
    </PageShell>
  );
}
