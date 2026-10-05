"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { use, useState, useId } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useSnackbar } from "@/components/ui/snackbar";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { RouteState } from "@/components/household/RouteState";
import { api } from "@/lib/trpc/client";
import type { FormEvent, JSX } from "react";
import { useQuantityFormat } from "@/lib/inventory/quantity";

/**
 * Stock correction — "what is actually there" (Phase 8 item 5).
 *
 * The same semantics the offline ReconcileDialog already uses: the person
 * counts what they can see and types the total; the delta is computed here
 * and written as one ADJUST entry with its reason. Asking for the *total*
 * rather than the difference is deliberate — counting a shelf is easy,
 * subtracting under pressure is how sign errors happen (see UI-3's history).
 */
function serverErrorKey(message: string | undefined): string {
  const normalized = message?.toLowerCase() ?? "";

  if (normalized.includes("stock changed")) return "errorStockChanged";
  if (normalized.includes("product not found")) return "errorNotFound";
  if (normalized.includes("household")) return "errorNoHousehold";

  return "errorGeneric";
}

interface AdjustStockPageProps {
  params: Promise<{ id: string }>;
}

export default function AdjustStockPage({
  params,
}: AdjustStockPageProps): JSX.Element {
  const { id } = use(params);
  return <AdjustStockView id={id} />;
}

/** Exported apart from the route so the component suite can render it. */
export function AdjustStockView({ id }: { id: string }): JSX.Element {
  const t = useTranslations("products.adjust");
  const units = useQuantityFormat();
  const tCommon = useTranslations("common");
  const tDetail = useTranslations("products.detail");
  const snackbar = useSnackbar();
  const utils = api.useUtils();

  const query = api.product.getById.useQuery({ id }, { retry: false });
  const product = query.data;

  const [actual, setActual] = useState("");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    actual?: string;
    reason?: string;
  }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [errorSignal, setErrorSignal] = useState(0);

  const actualId = useId();
  const actualHintId = useId();
  const actualErrorId = useId();
  const reasonId = useId();
  const reasonHintId = useId();
  const reasonErrorId = useId();

  const adjustStock = api.inventory.adjustStock.useMutation({
    onSuccess: async (_entry, variables) => {
      snackbar.show({
        kind: "confirm",
        message: {
          key: "products.adjust.saved",
          values: {
            name: product?.name ?? "",
            stock: (product?.totalStock ?? 0) + variables.quantity,
            unit: product?.defaultUnit ?? "",
          },
        },
      });
      await utils.invalidate();
    },
    onError: (error) => {
      setServerError(t(serverErrorKey(error.message)));
      void query.refetch();
      setErrorSignal((signal) => signal + 1);
    },
  });

  const summaryMessages = [
    fieldErrors.actual,
    fieldErrors.reason,
    serverError,
  ].filter((message): message is string => Boolean(message));

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!product) return;

    const errors: { actual?: string; reason?: string } = {};

    const parsed = Number(actual);
    if (actual.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
      errors.actual = t("errorActualInvalid");
    } else if (parsed === product.totalStock) {
      errors.actual = t("errorSame");
    }

    if (reason.trim() === "") {
      errors.reason = t("errorReasonRequired");
    }

    setServerError(null);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setErrorSignal((signal) => signal + 1);
      return;
    }

    adjustStock.mutate({
      productId: product.id,
      quantity: parsed - product.totalStock,
      expectedStock: product.totalStock,
      unit: product.defaultUnit,
      reason: reason.trim(),
    });
  }

  const back = { href: `/products/${id}`, label: t("backToProduct") };

  // Only while there is no product. A refetch that fails after a refused
  // adjustment used to replace the whole form — and what had been typed in
  // it — with an alert titled "No se ha podido guardar el ajuste", which
  // described the adjustment rather than the read.
  if (!product) {
    return (
      <RouteState
        back={back}
        error={query.error}
        fetchStatus={query.fetchStatus}
        isLoading={query.isPending}
        notFound={{
          title: tDetail("notFoundTitle"),
          body: t("errorNotFound"),
          back: { href: "/products", label: tDetail("backToProducts") },
        }}
        onRetry={() => void query.refetch()}
        title={t("title")}
        width="form"
      />
    );
  }

  return (
    <PageShell width="form">
      <PageHeader
        back={back}
        intro={t("intro")}
        title={t("titleOf", { name: product.name })}
      />

      <p className="rounded border border-border bg-muted p-4 text-foreground">
        {t("currentLabel", {
          stock: product.totalStock,
          unit: units.unit(product.defaultUnit, product.totalStock),
        })}
      </p>

      <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-6">
        <FormErrorSummary
          focusSignal={errorSignal}
          messages={summaryMessages}
          title={t("errorTitle")}
        />

        <div>
          <label
            htmlFor={actualId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("actualLabel")}
          </label>
          <Input
            id={actualId}
            name="actual"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            required
            value={actual}
            onChange={(event) => setActual(event.target.value)}
            aria-invalid={fieldErrors.actual ? true : undefined}
            aria-describedby={
              fieldErrors.actual
                ? `${actualHintId} ${actualErrorId}`
                : actualHintId
            }
          />
          <p id={actualHintId} className="mt-1 text-sm text-muted-foreground">
            {t("actualHint", { unit: units.measure(product.defaultUnit) })}
          </p>
          {fieldErrors.actual ? (
            <p
              id={actualErrorId}
              className="mt-1 text-sm font-medium text-danger-foreground"
            >
              {fieldErrors.actual}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor={reasonId}
            className="mb-1 block text-sm font-medium text-foreground"
          >
            {t("reasonLabel")}
          </label>
          <Textarea
            id={reasonId}
            name="reason"
            rows={3}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={fieldErrors.reason ? true : undefined}
            aria-describedby={
              fieldErrors.reason
                ? `${reasonHintId} ${reasonErrorId}`
                : reasonHintId
            }
          />
          <p id={reasonHintId} className="mt-1 text-sm text-muted-foreground">
            {t("reasonHint")}
          </p>
          {fieldErrors.reason ? (
            <p
              id={reasonErrorId}
              className="mt-1 text-sm font-medium text-danger-foreground"
            >
              {fieldErrors.reason}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={adjustStock.isPending}
          >
            {t("submit")}
          </Button>
          {/* "Cancelar", not "Volver al producto" a second time. The way out
              of the screen is the `BackLink` at the top; this is the form's
              own escape, sitting beside its submit. Both used to carry the
              same words and the same destination, so a screen reader
              announced two identical links and neither said which was which
              — and with the top one now drawing an arrow, the pair also
              looked like two different controls for one job. `Cancelar` is
              what the two other forms in settings call this. */}
          <Button asChild variant="outline">
            <Link href={`/products/${id}`}>{tCommon("cancel")}</Link>
          </Button>
          {/* Reduced to the pending state, which is what it was always for.
              An adjustment is an event and now says so in the snackbar. */}
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {adjustStock.isPending ? t("submitting") : ""}
          </p>
        </div>
      </form>
    </PageShell>
  );
}
