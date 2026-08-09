"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { use, useMemo } from "react";
import { api } from "@/lib/trpc/client";
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

/**
 * Formats an amount in the currency the record was stored with.
 *
 * `PriceRecord.currency` is a free-text column with a default, so a row written
 * by something other than this app could hold a code `Intl` rejects. That
 * throws a `RangeError`, which would take the whole page down over one bad
 * row — the number is still worth showing.
 */
function formatMoney(locale: string, amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      amount,
    );
  } catch {
    return `${amount} ${currency}`;
  }
}

export default function ProductDetailPage({
  params,
}: ProductDetailPageProps): JSX.Element {
  const { id } = use(params);
  const t = useTranslations("products.detail");
  const locale = useLocale();

  // `retry: false` because the likeliest failure here is a product id that does
  // not exist, and the shared QueryClient retries three times by default —
  // which would sit on the loading state for seconds before saying so.
  const query = api.product.getById.useQuery({ id }, { retry: false });
  const product = query.data;

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
          className="inline-flex min-h-[44px] items-center text-blue-700 underline"
        >
          {t("backToProducts")}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{t("loadingTitle")}</h1>
        <p role="status" aria-live="polite" className="mt-2 text-gray-700">
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
          className="inline-flex min-h-[44px] items-center text-blue-700 underline"
        >
          {t("backToProducts")}
        </Link>

        <div
          role="alert"
          className="mt-2 rounded border border-red-700 bg-red-50 p-4 text-red-900"
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
            className="mt-4 min-h-[44px] rounded border border-gray-500 bg-white px-4 py-2 font-medium text-gray-900 hover:bg-gray-100"
          >
            {t("retry")}
          </button>
        )}
      </div>
    );
  }

  const isLowStock =
    product.minStock !== null && product.totalStock < product.minStock;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/products"
        className="inline-flex min-h-[44px] items-center text-blue-700 underline"
      >
        {t("backToProducts")}
      </Link>

      <h1 className="mt-2 text-2xl font-bold">{product.name}</h1>

      {/* Decorative: the name it illustrates is directly above it, so an alt
          text would only repeat the heading. Open Food Facts is the only thing
          that ever sets `imageUrl`, and its host is the one remote origin the
          CSP allows in `img-src`. */}
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt=""
          className="mt-4 h-40 w-40 rounded border border-gray-300 bg-white object-contain"
        />
      ) : null}

      <h2 className="mt-6 text-lg font-semibold">{t("stockTitle")}</h2>
      <p className="mt-2 text-2xl font-bold text-gray-900">
        {t("stockValue", {
          quantity: product.totalStock,
          unit: product.defaultUnit,
        })}
      </p>
      {product.totalStock <= 0 ? (
        <p className="mt-1 font-medium text-red-800">{t("stockEmpty")}</p>
      ) : isLowStock && product.minStock !== null ? (
        <p className="mt-1 font-medium text-red-800">
          {t("stockLow", {
            minimum: product.minStock,
            unit: product.defaultUnit,
          })}
        </p>
      ) : null}

      <h2 className="mt-8 text-lg font-semibold">{t("locationsTitle")}</h2>
      {stockByLocation.length === 0 ? (
        <p className="mt-2 text-gray-700">{t("locationsEmpty")}</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-gray-200 rounded border border-gray-300 bg-white">
            {stockByLocation.map((total) => (
              <li
                key={total.key}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <span className="text-gray-900">
                  {total.name ?? t("locationNone")}
                </span>
                <span className="font-medium text-gray-900">
                  {t("stockValue", {
                    quantity: total.quantity,
                    unit: product.defaultUnit,
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-gray-700">{t("locationsNote")}</p>
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold">{t("expiryTitle")}</h2>
      {batches.length === 0 ? (
        <p className="mt-2 text-gray-700">{t("expiryEmpty")}</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-gray-200 rounded border border-gray-300 bg-white">
            {batches.map((batch) => (
              <li key={batch.id} className="px-4 py-3">
                <p className="font-medium text-gray-900">
                  {dateFormat.format(batch.expiresAt)}
                  {batch.expiresAt.getTime() < Date.now() ? (
                    <span className="ml-2 font-semibold text-red-800">
                      {t("expiryExpired")}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-sm text-gray-700">
                  {t("expiryBatch", {
                    quantity: batch.quantity,
                    unit: batch.unit,
                    location: batch.locationName ?? t("locationNone"),
                  })}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-gray-700">{t("expiryNote")}</p>
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold">{t("pricesTitle")}</h2>
      {product.priceRecords.length === 0 ? (
        <p className="mt-2 text-gray-700">{t("pricesEmpty")}</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse bg-white text-left">
            <caption className="sr-only">{t("pricesCaption")}</caption>
            <thead>
              <tr className="border-b border-gray-300">
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
                <tr key={record.id} className="border-b border-gray-200">
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
      )}
      <p className="mt-2">
        <Link
          href={`/prices/${product.id}`}
          className="inline-flex min-h-[44px] items-center text-blue-700 underline"
        >
          {t("pricesHistoryLink")}
        </Link>
      </p>

      <h2 className="mt-8 text-lg font-semibold">{t("detailsTitle")}</h2>
      <dl className="mt-2 space-y-3">
        <div>
          <dt className="text-sm font-medium text-gray-700">
            {t("brandLabel")}
          </dt>
          <dd className="text-gray-900">{product.brand || t("notSet")}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-700">
            {t("categoryLabel")}
          </dt>
          <dd className="text-gray-900">{product.category || t("notSet")}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-700">
            {t("barcodeLabel")}
          </dt>
          <dd className="font-mono text-gray-900">
            {product.barcode || t("notSet")}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-700">
            {t("unitLabel")}
          </dt>
          <dd className="text-gray-900">{product.defaultUnit}</dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-700">
            {t("minStockLabel")}
          </dt>
          <dd className="text-gray-900">
            {product.minStock === null
              ? t("minStockNone")
              : t("stockValue", {
                  quantity: product.minStock,
                  unit: product.defaultUnit,
                })}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-gray-700">
            {t("addedLabel")}
          </dt>
          <dd className="text-gray-900">
            {dateFormat.format(product.createdAt)}
          </dd>
        </div>
      </dl>

      <h2 className="mt-8 text-lg font-semibold">{t("actionsTitle")}</h2>
      <p className="mt-2 text-sm text-gray-700">
        {t("actionsHint", { name: product.name })}
      </p>
      <ul className="mt-2 space-y-2">
        <li>
          <Link
            href="/inventory/add"
            className="inline-flex min-h-[44px] items-center text-blue-700 underline"
          >
            {t("addStock")}
          </Link>
        </li>
        <li>
          <Link
            href="/inventory/consume"
            className="inline-flex min-h-[44px] items-center text-blue-700 underline"
          >
            {t("consumeStock")}
          </Link>
        </li>
      </ul>
    </div>
  );
}
