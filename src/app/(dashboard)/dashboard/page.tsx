"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { api } from "@/lib/trpc/client";
import type { JSX, ReactNode } from "react";

/**
 * Household overview — the screen every login lands on.
 *
 * It opens with the quick actions, because whoever lands here came to *do*
 * something — then raises alerts, and only alerts: things that require
 * attention, each leading with its reason rather than a headline figure
 * (Noel's review, 2026-08-19 — the catalogue size went with it, since a
 * count that asks nothing of anyone is not an alert). Each alert is still a
 * door to the list that shows its set (Phase 8 item 2):
 *
 * - `inventory.getStockOverview` with `needsRestock` — the same question
 *   /inventory?filter=restock asks, so alert and list cannot disagree.
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
 * One page of the restock list. `getStockOverview` is cursor-paginated and
 * capped at 100 per page; past that, the card says so in words rather than
 * quietly rounding — a wrong number is worse than an honest bound.
 */
const OVERVIEW_PAGE_SIZE = 100;

/** How many rows each section shows before it defers to its own page. */
const MAX_ROWS = 5;

export default function DashboardPage(): JSX.Element {
  const t = useTranslations("dashboard");

  // The restock alert asks the server for the same set its destination shows
  // (`needsRestock`, the filter /inventory?filter=restock uses) — an alert
  // and the list it opens must never disagree, because a number that is a
  // door people walk through gets trusted the way a number in a paragraph
  // does not (Phase 8 item 2).
  const restockQuery = api.inventory.getStockOverview.useQuery({
    limit: OVERVIEW_PAGE_SIZE,
    needsRestock: true,
  });
  const expiring = api.inventory.getExpiringItems.useQuery({
    days: EXPIRY_WINDOW_DAYS,
  });
  const expired = api.inventory.getExpiredItems.useQuery({});

  const restockRows = restockQuery.data?.products;

  /**
   * Everything worth buying, worst first.
   *
   * The server already filtered (out of stock, or below a set minimum); the
   * order is this screen's: run out outranks running low, and both cases are
   * labelled in words on the row.
   */
  const restock = useMemo(() => {
    if (!restockRows) return [];

    return [...restockRows].sort((a, b) => {
      const aOut = a.totalStock <= 0 ? 0 : 1;
      const bOut = b.totalStock <= 0 ? 0 : 1;
      if (aOut !== bOut) return aOut - bOut;
      return a.totalStock - b.totalStock;
    });
  }, [restockRows]);

  const isPending =
    restockQuery.isPending || expiring.isPending || expired.isPending;
  const failed = restockQuery.error ?? expiring.error ?? expired.error;

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

  if (failed || !restockRows) {
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
  const restockIsCapped = restockQuery.data?.nextCursor !== undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-heading">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("intro")}</p>
      </div>

      <section aria-labelledby="dashboard-quick">
        <h2 id="dashboard-quick" className="sr-only">
          {t("quickTitle")}
        </h2>
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <QuickLink href="/inventory/add" label={t("quickAddStock")} primary />
          <QuickLink href="/inventory/consume" label={t("quickConsumeStock")} />
          <QuickLink href="/receipts/upload" label={t("quickUploadReceipt")} />
          <QuickLink href="/products/scan" label={t("quickScan")} />
        </ul>
      </section>

      {/* Alerts, and only alerts: each exists because something needs doing,
          leads with the reason for it, and keeps its count in words below.
          When nothing needs attention there is nothing here — the sections
          below already say all is well, and a tile reporting zero problems
          is furniture. */}
      {atRisk + restock.length > 0 && (
        <section aria-labelledby="dashboard-alerts">
          <h2 id="dashboard-alerts" className="sr-only">
            {t("alertsTitle")}
          </h2>
          <ul className="space-y-2">
            {expiredItems.length > 0 && (
              <AlertLink
                detail={t("alertExpiredDetail", {
                  count: expiredItems.length,
                })}
                href="/inventory"
                reason={t("alertExpiredTitle")}
                tone="danger"
              />
            )}
            {expiringItems.length > 0 && (
              <AlertLink
                detail={t("alertExpiringDetail", {
                  count: expiringItems.length,
                  days: EXPIRY_WINDOW_DAYS,
                })}
                href="/inventory"
                reason={t("alertExpiringTitle")}
                tone="warn"
              />
            )}
            {restock.length > 0 && (
              <AlertLink
                detail={
                  restockIsCapped
                    ? t("alertRestockDetailCapped", { count: restock.length })
                    : t("alertRestockDetail", { count: restock.length })
                }
                href="/inventory?filter=restock"
                reason={t("alertRestockTitle")}
                tone="warn"
              />
            )}
          </ul>
        </section>
      )}

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

    </div>
  );
}

/**
 * One thing needing attention, and a door.
 *
 * The reason is the headline — it is what makes this an alert — and the
 * count lives in a sentence below it, because "7" is not the news, "hay que
 * reponer" is. The whole row is a link to the list showing exactly its set
 * (the owner's pass: a claim people act on has to be pressable, and what it
 * opens has to match it). The tone tints the edge and the reason, never the
 * whole row, and the words carry the severity on their own — colour is a
 * second signal here, not the only one (REDESIGN_PLAN §3).
 */
function AlertLink({
  detail,
  href,
  reason,
  tone,
}: {
  detail: string;
  href: string;
  reason: string;
  tone: "warn" | "danger";
}): JSX.Element {
  const edgeClass =
    tone === "danger" ? "border-l-danger-foreground" : "border-l-warn-foreground";
  const reasonClass =
    tone === "danger" ? "text-danger-foreground" : "text-warn-foreground";

  return (
    <li>
      <Link
        href={href}
        className={`flex min-h-[48px] items-center gap-3 rounded border border-border border-l-4 ${edgeClass} bg-card px-4 py-3 hover:bg-accent`}
      >
        <span className="min-w-0 flex-1">
          <span className={`block font-semibold ${reasonClass}`}>{reason}</span>
          <span className="block text-sm text-muted-foreground">{detail}</span>
        </span>
        <svg
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
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
