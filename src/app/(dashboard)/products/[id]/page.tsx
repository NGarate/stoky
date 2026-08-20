"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { isLowStock } from "@/lib/stock/low-stock";
import { api } from "@/lib/trpc/client";
import { ProductRating } from "@/components/products/ProductRating";
import type { JSX } from "react";

interface ProductDetailPageProps {
  params: Promise<{ id: string }>;
}

/** A location, or the absence of one, with the net quantity filed against it. */
interface LocationTotal {
  key: string;
  /** `null` for entries saved without a location. */
  name: string | null;
  quantity: number;
}

/** One stock entry that carries an expiry date, narrowed so the date is real. */
interface Batch {
  id: string;
  quantity: number;
  unit: string;
  expiresAt: Date;
  locationName: string | null;
}

/**
 * Turns a tRPC error into something a person can act on.
 *
 * The procedures throw plain English `Error`s, so there is no error code to
 * switch on. Matching on the message is fragile, which is why anything
 * unrecognised falls back to a generic, still-actionable message rather than
 * showing the raw text.
 *
 * `getById` looks the product up with `findFirst({ id, householdId })` and
 * throws the same "Product not found" whether the id is nonsense, belongs to a
 * deleted product, or belongs to another household. That is deliberate on the
 * server's part — distinguishing them would confirm to an outsider that a given
 * id exists — so this page says the one thing that is true in all three cases:
 * it is not in your household's catalogue.
 */
function serverErrorKey(message: string | undefined): string {
  const normalized = message?.toLowerCase() ?? "";

  if (normalized.includes("product not found")) return "errorNotFound";
  if (normalized.includes("household")) return "errorNoHousehold";

  return "errorGeneric";
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
  const locale = useLocale();

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

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (confirmingDelete) confirmRef.current?.focus();
  }, [confirmingDelete]);

  const utils = api.useUtils();
  const deleteProduct = api.product.delete.useMutation({
    onSuccess: async () => {
      setDeleted(product?.name ?? "");
      await utils.product.list.invalidate();
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

  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
    [locale],
  );

  /**
   * Net quantity per location.
   *
   * `getById` returns every stock entry, and a consumption is stored as a
   * negative entry rather than a decrement of the entry it came from. Summing
   * per location is therefore the only way to say where stock sits, and it
   * always adds up to `totalStock`. It can also show a location holding more
   * than it really does — see `locationsNote`.
   */
  const stockByLocation = useMemo<LocationTotal[]>(() => {
    if (!product) return [];

    const totals = new Map<string, LocationTotal>();

    for (const entry of product.stockEntries) {
      const key = entry.locationId ?? "";
      const current = totals.get(key);

      if (current) {
        current.quantity += entry.quantity;
      } else {
        totals.set(key, {
          key,
          name: entry.location?.name ?? null,
          quantity: entry.quantity,
        });
      }
    }

    return [...totals.values()]
      .filter((total) => total.quantity !== 0)
      .sort((a, b) => b.quantity - a.quantity);
  }, [product]);

  /**
   * Batches with an expiry date, soonest first.
   *
   * Only entries that added stock carry a date — a consumption never sets one —
   * so the negative entries are excluded rather than shown as batches expiring
   * in the past.
   */
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

    return product.stockEntries
      .flatMap((entry) =>
        entry.expirationDate && entry.quantity > 0
          ? [
              {
                id: entry.id,
                quantity: entry.quantity,
                unit: entry.unit,
                expiresAt: entry.expirationDate,
                locationName: entry.location?.name ?? null,
              },
            ]
          : [],
      )
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  }, [product]);

  if (query.isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link
          href="/products"
          className="inline-flex min-h-[48px] items-center text-primary underline"
        >
          {t("backToProducts")}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-heading">{t("loadingTitle")}</h1>
        <p role="status" aria-live="polite" className="mt-2 text-muted-foreground">
          {t("loading")}
        </p>
      </div>
    );
  }

  if (!product) {
    const errorKey = serverErrorKey(query.error?.message);

    return (
      <div className="mx-auto max-w-3xl">
        <Link
          href="/products"
          className="inline-flex min-h-[48px] items-center text-primary underline"
        >
          {t("backToProducts")}
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

  if (deleted !== null) {
    return (
      <div className="mx-auto max-w-3xl">
        <div
          role="status"
          tabIndex={-1}
          className="mt-2 rounded border border-ok-foreground bg-ok p-4 text-ok-foreground"
        >
          <h1 className="text-2xl font-bold">{t("deletedTitle")}</h1>
          <p className="mt-2">{t("deletedBody", { name: deleted })}</p>
        </div>
        <Link
          href="/products"
          className="mt-4 inline-flex min-h-[48px] items-center text-primary underline"
        >
          {t("deletedBack")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/products"
        className="inline-flex min-h-[48px] items-center text-primary underline"
      >
        {t("backToProducts")}
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-heading">{product.name}</h1>

      {/* Decorative: the name it illustrates is directly above it, so an alt
          text would only repeat the heading. Open Food Facts is the only thing
          that ever sets `imageUrl`, and its host is the one remote origin the
          CSP allows in `img-src`. */}
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt=""
          className="mt-4 h-40 w-40 rounded border border-border bg-card object-contain"
        />
      ) : null}

      <h2 className="mt-6 text-lg font-semibold text-heading">{t("stockTitle")}</h2>
      <p className="mt-2 text-2xl font-bold text-heading">
        {t("stockValue", {
          quantity: product.totalStock,
          unit: product.defaultUnit,
        })}
      </p>
      {product.totalStock <= 0 ? (
        <p className="mt-1 font-medium text-danger-foreground">{t("stockEmpty")}</p>
      ) : isLowStock(product.totalStock, product.minStock) ? (
        <p className="mt-1 font-medium text-danger-foreground">
          {t("stockLow", {
            minimum: product.minStock,
            unit: product.defaultUnit,
          })}
        </p>
      ) : null}

      {/* §3: scanning a known product lands here, and the rating is what the
          scan journey exists to show. Above locations because "is this a good
          buy" is the standing-in-the-shop question; where it lives at home is
          the after-the-shop one. */}
      <div className="mt-8">
        <ProductRating barcode={product.barcode} snapshot={product.openFoodFactsData} />
      </div>

      <h2 className="mt-8 text-lg font-semibold text-heading">{t("locationsTitle")}</h2>
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
                  {t("stockValue", {
                    quantity: total.quantity,
                    unit: product.defaultUnit,
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">{t("locationsNote")}</p>
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold text-heading">{t("expiryTitle")}</h2>
      {batches.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{t("expiryEmpty")}</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-border rounded border border-border bg-card">
            {batches.map((batch) => (
              <li key={batch.id} className="px-4 py-3">
                <p className="font-medium text-foreground">
                  {dateFormat.format(batch.expiresAt)}
                  {batch.expiresAt.getTime() < now ? (
                    <span className="ml-2 font-semibold text-danger-foreground">
                      {t("expiryExpired")}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("expiryBatch", {
                    quantity: batch.quantity,
                    unit: batch.unit,
                    location: batch.locationName ?? t("locationNone"),
                  })}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">{t("expiryNote")}</p>
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold text-heading">{t("pricesTitle")}</h2>
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
                      {dateFormat.format(record.recordedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t("priceQuantityHeader")}
                    </dt>
                    <dd className="mt-1 text-foreground">
                      {t("stockValue", {
                        quantity: record.quantity,
                        unit: record.unit,
                      })}
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
                    {dateFormat.format(record.recordedAt)}
                  </td>
                  <td className="px-4 py-2">{record.store.name}</td>
                  <td className="px-4 py-2">
                    {formatMoney(locale, record.price, record.currency)}
                  </td>
                  <td className="px-4 py-2">
                    {t("stockValue", {
                      quantity: record.quantity,
                      unit: record.unit,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
      <p className="mt-2">
        <Link
          href={`/prices/${product.id}`}
          className="inline-flex min-h-[48px] items-center text-primary underline"
        >
          {t("pricesHistoryLink")}
        </Link>
      </p>

      <h2 className="mt-8 text-lg font-semibold text-heading">{t("detailsTitle")}</h2>
      <dl className="mt-2 space-y-3">
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            {t("brandLabel")}
          </dt>
          <dd className="text-foreground">{product.brand || t("notSet")}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            {t("categoryLabel")}
          </dt>
          <dd className="text-foreground">{product.category || t("notSet")}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            {t("barcodeLabel")}
          </dt>
          <dd className="font-mono text-foreground">
            {product.barcode || t("notSet")}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            {t("unitLabel")}
          </dt>
          <dd className="text-foreground">{product.defaultUnit}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            {t("minStockLabel")}
          </dt>
          <dd className="text-foreground">
            {product.minStock === null
              ? t("minStockNone")
              : t("stockValue", {
                  quantity: product.minStock,
                  unit: product.defaultUnit,
                })}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">
            {t("addedLabel")}
          </dt>
          <dd className="text-foreground">
            {dateFormat.format(product.createdAt)}
          </dd>
        </div>
      </dl>

      <h2 className="mt-8 text-lg font-semibold text-heading">{t("actionsTitle")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("actionsHint", { name: product.name })}
      </p>
      <ul className="mt-2 space-y-2">
        <li>
          <Link
            href={`/products/${product.id}/edit`}
            className="inline-flex min-h-[48px] items-center text-primary underline"
          >
            {t("editProduct")}
          </Link>
        </li>
        <li>
          <Link
            href="/inventory/add"
            className="inline-flex min-h-[48px] items-center text-primary underline"
          >
            {t("addStock")}
          </Link>
        </li>
        <li>
          <Link
            href="/inventory/consume"
            className="inline-flex min-h-[48px] items-center text-primary underline"
          >
            {t("consumeStock")}
          </Link>
        </li>
        <li>
          <Link
            href={`/products/${product.id}/adjust`}
            className="inline-flex min-h-[48px] items-center text-primary underline"
          >
            {t("adjustStock")}
          </Link>
        </li>
        <li>
          <Link
            href={`/products/${product.id}/history`}
            className="inline-flex min-h-[48px] items-center text-primary underline"
          >
            {t("stockHistoryLink")}
          </Link>
        </li>
      </ul>

      {/* Owner-directed (Phase 8 item 5, D90): admin-only, confirmed, and only
          for a product nothing references. Anything with history keeps it —
          the history is the record the other screens exist to show — so the
          button is only offered when the ledger is empty, and the server's
          four-way count is still the control behind it. */}
      {isAdmin ? (
        <section aria-labelledby="product-delete" className="mt-10 rounded border border-border bg-muted p-4">
          <h2 id="product-delete" className="text-lg font-semibold text-heading">
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
                <button
                  type="button"
                  disabled={deleteProduct.isPending}
                  onClick={() => deleteProduct.mutate({ id: product.id })}
                  className="min-h-[48px] rounded bg-destructive px-4 py-2 font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
                >
                  {t("deleteConfirm")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteError(null);
                  }}
                  className="min-h-[48px] rounded border border-input bg-card px-4 py-2 text-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  {t("deleteCancel")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">{t("deleteHint")}</p>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="mt-3 min-h-[48px] rounded border border-danger-foreground bg-card px-4 py-2 font-medium text-danger-foreground hover:bg-danger"
              >
                {t("deleteButton")}
              </button>
            </>
          )}
          {/* Kept mounted so a refusal is announced when it arrives. */}
          <p role="status" aria-live="polite" className="mt-2 text-sm font-medium text-danger-foreground">
            {deleteError ?? ""}
          </p>
        </section>
      ) : null}
    </div>
  );
}
