"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { api } from "@/lib/trpc/client";
import type { JSX, ReactNode } from "react";

/**
 * Household overview — the screen every login lands on.
 *
 * It answers three questions and nothing else: what is running out, what is
 * about to go off, and how big the catalogue is. Everything it shows comes from
 * procedures that already exist; no new server work was needed:
 *
 * - `inventory.getStockOverview` — net stock per product plus the `isLowStock`
 *   flag the server derives from `minStock`.
 * - `inventory.getExpiringItems` — batches with a date inside the window.
 * - `inventory.getExpiredItems` — batches already past their date.
 *
 * This is the desktop overview, not the phone or kitchen screen. Those are
 * Phases 4 and 5 of docs/REDESIGN_PLAN.md and are deliberately not attempted
 * here: no scanner, no ± stepper, no metre-away type.
 */

/** How far ahead the expiry section looks. */
const EXPIRY_WINDOW_DAYS = 7;

/**
 * `getStockOverview` is a cursor-paginated list capped at 100 per page, so the
 * catalogue figure is "at least this many" rather than a true count. Said in
 * words on screen rather than quietly rounded, because a wrong number is worse
 * than an honest bound.
 */
const OVERVIEW_PAGE_SIZE = 100;

/** How many rows each section shows before it defers to its own page. */
const MAX_ROWS = 5;

export default function DashboardPage(): JSX.Element {
  const t = useTranslations("dashboard");

  const overview = api.inventory.getStockOverview.useQuery({
    limit: OVERVIEW_PAGE_SIZE,
  });
  const expiring = api.inventory.getExpiringItems.useQuery({
    days: EXPIRY_WINDOW_DAYS,
  });
  const expired = api.inventory.getExpiredItems.useQuery({});

  const products = overview.data?.products;

  /**
   * Everything worth buying, worst first.
   *
   * Out of stock outranks low stock: `isLowStock` is only true when a minimum
   * is set, so a product that has run out without one would otherwise never
   * appear. Both cases are labelled in words on the row.
   */
  const restock = useMemo(() => {
    if (!products) return [];

    return products
      .filter((product) => product.totalStock <= 0 || product.isLowStock)
      .sort((a, b) => {
        const aOut = a.totalStock <= 0 ? 0 : 1;
        const bOut = b.totalStock <= 0 ? 0 : 1;
        if (aOut !== bOut) return aOut - bOut;
        return a.totalStock - b.totalStock;
      });
  }, [products]);

  const isPending =
    overview.isPending || expiring.isPending || expired.isPending;
  const failed = overview.error ?? expiring.error ?? expired.error;

  if (isPending) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold text-heading">{t("title")}</h1>
        <p role="status" aria-live="polite" className="mt-2 text-muted-foreground">
          {t("loading")}
        </p>
      </div>
    );
  }

  if (failed || !products) {
    // Every procedure on this page throws the same "User not in a household"
    // when the session has no household, which is the one failure a person can
    // actually act on. Anything else is reported generically rather than as raw
    // server text.
    const isNoHousehold = (failed?.message ?? "")
      .toLowerCase()
      .includes("household");

    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold text-heading">{t("title")}</h1>
        <div
          role="alert"
          className="mt-4 rounded border border-danger-foreground bg-danger p-4 text-danger-foreground"
        >
          <h2 className="font-semibold">{t("errorTitle")}</h2>
          <p className="mt-2">
            {isNoHousehold ? t("errorNoHousehold") : t("errorGeneric")}
          </p>
        </div>
      </div>
    );
  }

  const expiredItems = expired.data ?? [];
  const expiringItems = expiring.data ?? [];
  const atRisk = expiredItems.length + expiringItems.length;
  const catalogueIsCapped = overview.data?.nextCursor !== undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-heading">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("intro")}</p>
      </div>

      <section aria-labelledby="dashboard-summary">
        <h2 id="dashboard-summary" className="sr-only">
          {t("summaryTitle")}
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          <StatCard
            label={t("statProducts")}
            note={catalogueIsCapped ? t("statProductsCapped") : undefined}
            value={products.length}
          />
          <StatCard
            label={t("statRestock")}
            tone={restock.length > 0 ? "warn" : "ok"}
            value={restock.length}
          />
          <StatCard
            label={t("statAtRisk", { days: EXPIRY_WINDOW_DAYS })}
            tone={expiredItems.length > 0 ? "danger" : atRisk > 0 ? "warn" : "ok"}
            value={atRisk}
          />
        </ul>
      </section>

      <section aria-labelledby="dashboard-restock">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="dashboard-restock"
            className="text-lg font-semibold text-heading"
          >
            {t("restockTitle")}
          </h2>
          <Link
            href="/shopping"
            className="inline-flex min-h-[48px] items-center text-sm text-primary underline underline-offset-4"
          >
            {t("restockListLink")}
          </Link>
        </div>

        {restock.length === 0 ? (
          <p className="mt-2 text-muted-foreground">{t("restockEmpty")}</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border rounded border border-border bg-card">
              {restock.slice(0, MAX_ROWS).map((product) => (
                <li
                  key={product.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <Link
                    href={`/products/${product.id}`}
                    className="inline-flex min-h-[48px] items-center font-medium text-primary underline underline-offset-4"
                  >
                    {product.name}
                  </Link>
                  {product.totalStock <= 0 ? (
                    <span className="rounded bg-danger px-2 py-1 text-sm font-medium text-danger-foreground">
                      {t("restockOut")}
                    </span>
                  ) : (
                    <span className="rounded bg-warn px-2 py-1 text-sm font-medium text-warn-foreground">
                      {t("restockLow", {
                        quantity: product.totalStock,
                        minimum: product.minStock ?? 0,
                        unit: product.defaultUnit,
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {restock.length > MAX_ROWS ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("restockMore", { count: restock.length - MAX_ROWS })}
              </p>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="dashboard-expiry">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="dashboard-expiry"
            className="text-lg font-semibold text-heading"
          >
            {t("expiryTitle", { days: EXPIRY_WINDOW_DAYS })}
          </h2>
          <Link
            href="/inventory"
            className="inline-flex min-h-[48px] items-center text-sm text-primary underline underline-offset-4"
          >
            {t("expiryInventoryLink")}
          </Link>
        </div>

        {atRisk === 0 ? (
          <p className="mt-2 text-muted-foreground">{t("expiryEmpty")}</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border rounded border border-border bg-card">
              {expiredItems.slice(0, MAX_ROWS).map((item) => (
                <ExpiryRow
                  key={item.id}
                  location={item.location?.name ?? null}
                  name={item.product.name}
                  noLocationLabel={t("expiryNoLocation")}
                  productId={item.product.id}
                  quantity={t("expiryQuantity", {
                    quantity: item.quantity,
                    unit: item.unit,
                  })}
                  status={
                    <span className="rounded bg-danger px-2 py-1 text-sm font-medium text-danger-foreground">
                      {t("expiryExpired", { days: item.daysExpired })}
                    </span>
                  }
                />
              ))}
              {expiringItems.slice(0, MAX_ROWS).map((item) => (
                <ExpiryRow
                  key={item.id}
                  location={item.location?.name ?? null}
                  name={item.product.name}
                  noLocationLabel={t("expiryNoLocation")}
                  productId={item.product.id}
                  quantity={t("expiryQuantity", {
                    quantity: item.quantity,
                    unit: item.unit,
                  })}
                  status={
                    <span
                      className={`rounded px-2 py-1 text-sm font-medium ${
                        item.isExpiringSoon
                          ? "bg-danger text-danger-foreground"
                          : "bg-warn text-warn-foreground"
                      }`}
                    >
                      {item.daysUntilExpiry <= 0
                        ? t("expiryToday")
                        : item.daysUntilExpiry === 1
                          ? t("expiryTomorrow")
                          : t("expiryInDays", { days: item.daysUntilExpiry })}
                    </span>
                  }
                />
              ))}
            </ul>
            {expiredItems.length > MAX_ROWS ||
            expiringItems.length > MAX_ROWS ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("expiryMore")}
              </p>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="dashboard-quick">
        <h2 id="dashboard-quick" className="text-lg font-semibold text-heading">
          {t("quickTitle")}
        </h2>
        <ul className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <QuickLink href="/inventory/add" label={t("quickAddStock")} primary />
          <QuickLink href="/inventory/consume" label={t("quickConsumeStock")} />
          <QuickLink href="/receipts/upload" label={t("quickUploadReceipt")} />
          <QuickLink href="/products/scan" label={t("quickScan")} />
        </ul>
      </section>
    </div>
  );
}

/**
 * One headline figure.
 *
 * The tone tints the figure, never the whole tile, and the label underneath
 * always says what the number is — colour is a second signal here, not the
 * only one (REDESIGN_PLAN §3).
 */
function StatCard({
  label,
  note,
  tone = "neutral",
  value,
}: {
  label: string;
  note?: string | undefined;
  tone?: "neutral" | "ok" | "warn" | "danger";
  value: number;
}): JSX.Element {
  const toneClass = {
    neutral: "text-heading",
    ok: "text-ok-foreground",
    warn: "text-warn-foreground",
    danger: "text-danger-foreground",
  }[tone];

  return (
    <li className="rounded border border-border bg-card p-4">
      <p className={`text-3xl font-bold ${toneClass}`}>{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      {note ? (
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      ) : null}
    </li>
  );
}

/** One batch that has expired or is about to. */
function ExpiryRow({
  location,
  name,
  noLocationLabel,
  productId,
  quantity,
  status,
}: {
  location: string | null;
  name: string;
  noLocationLabel: string;
  productId: string;
  quantity: string;
  status: ReactNode;
}): JSX.Element {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div>
        <Link
          href={`/products/${productId}`}
          className="inline-flex min-h-[48px] items-center font-medium text-primary underline underline-offset-4"
        >
          {name}
        </Link>
        <p className="mt-1 text-sm text-muted-foreground">
          {quantity} · {location ?? noLocationLabel}
        </p>
      </div>
      {status}
    </li>
  );
}

/** One onward route out of the overview. */
function QuickLink({
  href,
  label,
  primary = false,
}: {
  href: string;
  label: string;
  primary?: boolean;
}): JSX.Element {
  return (
    <li>
      <Link
        href={href}
        className={`flex min-h-[48px] items-center justify-center rounded px-4 py-2 text-center font-medium ${
          primary
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "border border-input bg-card text-foreground hover:bg-accent hover:text-accent-foreground"
        }`}
      >
        {label}
      </Link>
    </li>
  );
}
