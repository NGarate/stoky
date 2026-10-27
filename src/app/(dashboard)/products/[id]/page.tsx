"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { isLowStock } from "@/lib/stock/low-stock";
import { ProductDetailsForm } from "@/components/products/ProductDetailsForm";
import { useSnackbar } from "@/components/ui/snackbar";
import { Button } from "@/components/ui/button";
import { sectionHeading } from "@/components/ui/section";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { RouteState } from "@/components/household/RouteState";
import { api } from "@/lib/trpc/client";
import { ProductRating } from "@/components/products/ProductRating";
import { QuantityStepper } from "@/components/inventory/QuantityStepper";
import { ExpiryStatus } from "@/components/inventory/ExpiryStatus";
import { useQuantityFormat } from "@/lib/inventory/quantity";
import { useWriteQueue } from "@/lib/offline/queue-context";
import { undoHoldMs } from "@/lib/snackbar-duration";
import { projectStockTotals } from "@/lib/offline/project";
import {
  daysUntilExpiry,
  remainingByBatch,
  startOfToday,
} from "@/lib/inventory/batches";
import { Decimal } from "@prisma/client-runtime-utils";
import type { JSX } from "react";
import { formatDate } from "@/lib/dates";

interface ProductDetailPageProps {
  params: Promise<{ id: string }>;
}

/** A location, or the absence of one, with the net quantity filed against it. */
interface LocationTotal {
  key: string;
  /** `null` for entries saved without a location. */
  name: string | null;
  quantity: Decimal | null;
}

/** One stock entry that carries an expiry date, narrowed so the date is real. */
interface Batch {
  id: string;
  quantity: Decimal | null;
  unit: string;
  expiresAt: Date;
  locationName: string | null;
}

export default function ProductDetailPage({
  params,
}: ProductDetailPageProps): JSX.Element {
  const { id } = use(params);
  return <ProductDetailView id={id} />;
}

/** Exported apart from the route so the component suite can render it. */
export function ProductDetailView({ id }: { id: string }): JSX.Element {
  const t = useTranslations("products.detail");
  const units = useQuantityFormat();
  const locale = useLocale();
  const router = useRouter();
  const snackbar = useSnackbar();
  const { state: queueState, enqueue } = useWriteQueue();

  // `retry: false` because the likeliest failure here is a product id that does
  // not exist, and the shared QueryClient retries three times by default —
  // which would sit on the loading state for seconds before saying so.
  const query = api.product.getById.useQuery({ id }, { retry: false });
  const product = query.data;

  // The signed-in account's role, for showing the delete section to the
  // people the server would let use it. Hiding it from everyone else is
  // courtesy, not the control — `adminProcedure` is the control (D90).
  // First caller of `auth.me`, which waited for exactly this.
  const me = api.auth.me.useQuery(undefined, { retry: false });
  const isAdmin = me.data?.role === "OWNER" || me.data?.role === "ADMIN";
  // `writeProcedure` admits OWNER, ADMIN and MEMBER; KITCHEN reads only
  // (CAPABILITY_ROLES in trpc.ts). Hiding the control from a KITCHEN tablet
  // is courtesy — the server is the control, the same shape as the delete
  // section below (D90).
  const canWrite = isAdmin || me.data?.role === "MEMBER";

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (confirmingDelete) confirmRef.current?.focus();
  }, [confirmingDelete]);

  const utils = api.useUtils();
  const deleteProduct = api.product.delete.useMutation({
    /**
     * Leave, and say so on the way out.
     *
     * The other three success outcomes in this application are dialogs over
     * the screen that produced them, because that screen is still true
     * afterwards and still useful. This one is not: the page describes a
     * product that no longer exists, so staying to show a confirmation on top
     * of a dead record is the strangest of the four options. The snackbar
     * carries the sentence across the navigation — it is mounted in the
     * dashboard layout, above every route.
     *
     * `product.getById` is deliberately *not* invalidated. Refetching a
     * deleted product mid-navigation makes this page render its own
     * not-found alert on the way out.
     */
    onSuccess: () => {
      snackbar.show({
        kind: "confirm",
        message: {
          key: "products.detail.deletedBody",
          values: { name: product?.name ?? "" },
        },
      });
      router.replace("/products");
      // Not awaited, and deliberately after the navigation: leaving should
      // not wait on a cache invalidation. The list refetches on arrival
      // either way, because the query is mounted by then.
      void utils.product.list.invalidate();
    },
    onError: (error) => {
      const normalized = error.message.toLowerCase();
      setDeleteError(
        normalized.includes("still has")
          ? t("deleteConflict")
          : t("deleteFailed"),
      );
    },
  });

  /** Sum the surviving batches; unknown withdrawals never become a fake shelf balance. */
  const stockByLocation = useMemo<LocationTotal[]>(() => {
    if (!product) return [];

    const totals = new Map<string, LocationTotal>();
    const remaining = remainingByBatch(product.stockEntries);

    for (const entry of product.stockEntries) {
      if (entry.quantity.lessThanOrEqualTo(0)) continue;
      const quantity = remaining.get(entry.id) ?? null;
      const key = entry.locationId ?? "";
      const current = totals.get(key);

      if (current) {
        current.quantity =
          current.quantity === null || quantity === null
            ? null
            : current.quantity.plus(quantity);
      } else {
        totals.set(key, {
          key,
          name: entry.location?.name ?? null,
          quantity,
        });
      }
    }

    return [...totals.values()]
      .filter((total) => total.quantity?.isZero() !== true)
      .sort((a, b) => new Decimal(b.quantity ?? 0).comparedTo(a.quantity ?? 0));
  }, [product]);

  /**
   * One instant for the whole render, captured once per mount.
   *
   * `Date.now()` reached from JSX is an impure call during render: it stops
   * the React Compiler memoising this list, and two batches compared against
   * two different "now"s can disagree. A lazy `useState` initialiser runs once
   * and React owns the memoisation of it.
   */
  const [now] = useState(() => Date.now());

  const batches = useMemo<Batch[]>(() => {
    if (!product) return [];

    const remaining = remainingByBatch(product.stockEntries);
    return product.stockEntries
      .flatMap((entry) =>
        entry.expirationDate &&
        entry.quantity.greaterThan(0) &&
        remaining.get(entry.id)?.isZero() !== true
          ? [
              {
                id: entry.id,
                quantity: remaining.get(entry.id) ?? null,
                unit: entry.unit,
                expiresAt: entry.expirationDate,
                locationName: entry.location?.name ?? null,
              },
            ]
          : [],
      )
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  }, [product]);

  const back = { href: "/products", label: t("backToProducts") };

  /**
   * Every state without a product, through the one component that tells them
   * apart. This screen hand-rolled two: `isPending` drew "Cargando…" — which
   * a query paused offline also is, so with no signal it said loading for
   * ever (UI-8) — and everything else was one red alert that matched the
   * server's English to guess whether the household was missing.
   *
   * `getById` answers NOT_FOUND alike for a nonsense id, a deleted product
   * and another household's — deliberately, so an outsider cannot confirm an
   * id exists — and the sentence says the one thing true of all three.
   */
  if (!product) {
    return (
      <RouteState
        back={back}
        error={query.error}
        fetchStatus={query.fetchStatus}
        isLoading={query.isPending}
        notFound={{ title: t("notFoundTitle"), body: t("errorNotFound") }}
        onRetry={() => void query.refetch()}
        title={t("loadingTitle")}
        width="detail"
      />
    );
  }

  /**
   * The total as the screen should show it: the server's answer with the
   * queue's unsent changes folded on. Derived at render rather than written
   * into the cache, for the reasons `project.ts` opens with — one source, no
   * drift, and a press made offline shows immediately. The low-stock lines
   * read it too: two presses that lift a product past its minimum must also
   * take the "below minimum" sentence away.
   */
  const shownStock =
    projectStockTotals(
      new Map([[product.id, product.totalStock]]),
      queueState.pending,
    ).get(product.id) ?? product.totalStock;

  /**
   * One press, one delta — §3 flow 3, Journey 4.
   *
   * Plus books a purchase of one and minus a consumption of one, so the
   * ledger records what happened rather than a new absolute value — the
   * property Journey 6's history depends on. Both go through the queue with
   * the shared ten-second hold: the confirmation is the snackbar's sentence,
   * and undo is cancelling the queued change, never a compensating write
   * (D57 — an `addStock` to reverse a consumption fabricates an acquisition).
   *
   * Unspecified location and expiry stay unknown; a previous purchase does
   * not describe where this new unit was put.
   */
  function stepStock(direction: "add" | "remove"): void {
    if (!product) return;
    const label = {
      key: direction === "add" ? "offline.addedStock" : "offline.usedUp",
      values: { quantity: 1, unit: product.defaultUnit, name: product.name },
    };
    const queued = enqueue(
      direction === "add"
        ? {
            path: "inventory.addStock",
            input: {
              productId: product.id,
              quantity: 1,
              unit: product.defaultUnit,
            },
            label,
            holdMs: undoHoldMs(),
          }
        : {
            path: "inventory.consumeStock",
            input: {
              productId: product.id,
              quantity: 1,
              unit: product.defaultUnit,
            },
            label,
            holdMs: undoHoldMs(),
          },
    );

    // Refused for want of room: the shell's own banner reports a full queue,
    // which is a state. Claiming the change was made would be a lie.
    if (!queued.ok) return;

    snackbar.show({ kind: "undo-queued", message: label, opId: queued.id });
  }

  return (
    <PageShell width="detail">
      <PageHeader back={back} className="mb-0" title={product.name} />

      {/* Decorative: the name it illustrates is directly above it, so an alt
          text would only repeat the heading. Open Food Facts is the only thing
          that ever sets `imageUrl`, and its host is the one remote origin the
          CSP allows in `img-src`. `no-referrer` because the request tells that
          host nothing it needs: `Referrer-Policy: same-origin` already says so
          for the whole page, and this holds behind a proxy that rewrites it. */}
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="mt-4 h-40 w-40 rounded border border-border bg-card object-contain"
        />
      ) : null}

      <h2 className={`mt-6 ${sectionHeading()}`}>{t("stockTitle")}</h2>
      {/* §3 flow 3: changing stock is the stepper, not a form. Offered only to
          the roles `writeProcedure` admits — plus is `addStock`, which a
          KITCHEN account would be refused — so a kitchen tablet reads the
          number instead of a control the server would bounce (D90's shape:
          hiding is courtesy, the middleware is the control). */}
      {canWrite ? (
        <div className="mt-2">
          <QuantityStepper
            addLabel={t("stepperAdd", {
              unit: units.unit(product.defaultUnit, 1),
              name: product.name,
            })}
            onAdd={() => stepStock("add")}
            onRemove={() => stepStock("remove")}
            removeDisabled={shownStock.lessThanOrEqualTo(0)}
            removeLabel={t("stepperRemove", {
              unit: units.unit(product.defaultUnit, 1),
              name: product.name,
            })}
            unit={units.unit(product.defaultUnit, shownStock)}
            value={shownStock}
          />
        </div>
      ) : (
        <p className="mt-2 text-2xl font-bold text-heading">
          {units.quantity(shownStock, product.defaultUnit)}
        </p>
      )}
      {shownStock.lessThanOrEqualTo(0) ? (
        <p className="mt-1 font-medium text-danger-foreground">
          {t("stockEmpty")}
        </p>
      ) : isLowStock(shownStock, product.minStock) ? (
        <p className="mt-1 font-medium text-danger-foreground">
          {t("stockLow", {
            minimum: product.minStock.toNumber(),
            unit: units.unit(product.defaultUnit, product.minStock ?? 0),
          })}
        </p>
      ) : null}

      {/* §3: scanning a known product lands here, and the rating is what the
          scan journey exists to show. Above locations because "is this a good
          buy" is the standing-in-the-shop question; where it lives at home is
          the after-the-shop one. */}
      <div className="mt-8">
        <ProductRating
          barcode={product.barcode}
          snapshot={product.openFoodFactsData}
        />
      </div>

      <h2 className={`mt-8 ${sectionHeading()}`}>{t("locationsTitle")}</h2>
      {stockByLocation.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{t("locationsEmpty")}</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-border rounded border border-border bg-card">
            {stockByLocation.map((total) => (
              <li
                key={total.key}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <span className="text-foreground">
                  {total.name ?? t("locationNone")}
                </span>
                <span className="font-medium text-foreground">
                  {total.quantity === null
                    ? t("quantityUnknown")
                    : units.quantity(total.quantity, product.defaultUnit)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("locationsNote")}
          </p>
        </>
      )}

      <h2 className={`mt-8 ${sectionHeading()}`}>{t("expiryTitle")}</h2>
      {batches.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{t("expiryEmpty")}</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-border rounded border border-border bg-card">
            {batches.map((batch) => (
              <li key={batch.id} className="px-4 py-3">
                <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                  {formatDate(locale, batch.expiresAt, "long", {
                    dateOnly: true,
                  })}
                  {/* A date, not an instant: dated today is not yet expired.
                      The words and tone are the ones every other screen
                      uses for a batch's date — this was a bare red
                      "Caducado" span, not a pill, saying nothing at all
                      about a batch that goes off tomorrow. */}
                  <ExpiryStatus
                    daysUntilExpiry={daysUntilExpiry(
                      batch.expiresAt,
                      startOfToday(new Date(now)),
                    )}
                  />
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("expiryBatch", {
                    amount:
                      batch.quantity === null
                        ? t("quantityUnknown")
                        : units.quantity(batch.quantity, batch.unit),
                    location: batch.locationName ?? t("locationNone"),
                  })}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("expiryNote")}
          </p>
        </>
      )}

      <h2 className={`mt-8 ${sectionHeading()}`}>{t("pricesTitle")}</h2>
      {product.priceRecords.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{t("pricesEmpty")}</p>
      ) : (
        <>
          {/* Phone and tablet: one card per price record. Every column the
              table carries is on the card — date, store, amount and quantity —
              stacked rather than dropped (DESIGN_AUDIT A3.2). */}
          <ul className="mt-2 space-y-3 lg:hidden">
            {product.priceRecords.map((record) => (
              <li
                key={record.id}
                className="rounded border border-border bg-card p-4"
              >
                <p className="font-medium text-foreground md:text-xl">
                  {record.store.name}
                </p>
                <p className="mt-1 text-lg font-semibold text-heading md:text-2xl">
                  {formatMoney(locale, record.price, record.currency)}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:text-lg">
                  <div>
                    <dt className="text-muted-foreground">
                      {t("priceDateHeader")}
                    </dt>
                    <dd className="mt-1 text-foreground">
                      {formatDate(locale, record.recordedAt, "long")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t("priceQuantityHeader")}
                    </dt>
                    <dd className="mt-1 text-foreground">
                      {units.quantity(record.quantity, record.unit)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>

          <div className="mt-2 hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse bg-card text-left">
              <caption className="sr-only">{t("pricesCaption")}</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t("priceDateHeader")}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t("priceStoreHeader")}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t("priceAmountHeader")}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t("priceQuantityHeader")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {product.priceRecords.map((record) => (
                  <tr key={record.id} className="border-b border-border">
                    <td className="px-4 py-2">
                      {formatDate(locale, record.recordedAt, "long")}
                    </td>
                    <td className="px-4 py-2">{record.store.name}</td>
                    <td className="px-4 py-2">
                      {formatMoney(locale, record.price, record.currency)}
                    </td>
                    <td className="px-4 py-2">
                      {units.quantity(record.quantity, record.unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-2">
        <Button asChild variant="link">
          <Link href={`/prices/${product.id}`}> {t("pricesHistoryLink")} </Link>
        </Button>
      </p>

      <ProductDetailsForm
        canEdit={canWrite}
        formattedDate={formatDate(locale, product.createdAt, "long")}
        product={product}
      />

      <h2 className={`mt-8 ${sectionHeading()}`}>{t("actionsTitle")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("actionsHint", { name: product.name })}
      </p>
      <ul className="mt-2 space-y-2">
        <li>
          <Button asChild variant="link">
            <Link href="/inventory/add"> {t("addStock")} </Link>
          </Button>
        </li>
        <li>
          <Button asChild variant="link">
            <Link href="/inventory/consume"> {t("consumeStock")} </Link>
          </Button>
        </li>
        <li>
          <Button asChild variant="link">
            <Link href={`/products/${product.id}/adjust`}>
              {" "}
              {t("adjustStock")}{" "}
            </Link>
          </Button>
        </li>
        <li>
          <Button asChild variant="link">
            <Link href={`/products/${product.id}/history`}>
              {" "}
              {t("stockHistoryLink")}{" "}
            </Link>
          </Button>
        </li>
      </ul>

      {/* Owner-directed (Phase 8 item 5, D90): admin-only, confirmed, and only
          for a product nothing references. Anything with history keeps it —
          the history is the record the other screens exist to show — so the
          button is only offered when the ledger is empty, and the server's
          four-way count is still the control behind it. */}
      {isAdmin ? (
        <section
          aria-labelledby="product-delete"
          className="mt-10 rounded border border-border bg-muted p-4"
        >
          <h2 id="product-delete" className={sectionHeading()}>
            {t("deleteTitle")}
          </h2>
          {product.stockEntries.length > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("deleteBlockedHistory")}
            </p>
          ) : confirmingDelete ? (
            <div
              ref={confirmRef}
              role="group"
              aria-label={t("deleteConfirmTitle", { name: product.name })}
              tabIndex={-1}
              className="mt-3 rounded border border-danger-foreground bg-danger p-4"
            >
              <p className="font-semibold text-danger-foreground">
                {t("deleteConfirmTitle", { name: product.name })}
              </p>
              <p className="mt-1 text-sm text-danger-foreground">
                {t("deleteConfirmBody")}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button
                  type="button"
                  disabled={deleteProduct.isPending}
                  onClick={() => deleteProduct.mutate({ id: product.id })}
                  variant="destructive"
                >
                  {t("deleteConfirm")}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteError(null);
                  }}
                  variant="outline"
                >
                  {t("deleteCancel")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("deleteHint")}
              </p>
              <Button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                variant="destructive-ghost"
              >
                {t("deleteButton")}
              </Button>
            </>
          )}
          {/* Kept mounted so a refusal is announced when it arrives. */}
          <p
            role="status"
            aria-live="polite"
            className="mt-2 text-sm font-medium text-danger-foreground"
          >
            {deleteError ?? ""}
          </p>
        </section>
      ) : null}
    </PageShell>
  );
}
