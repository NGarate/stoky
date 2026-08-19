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
 * something — then one short sentence saying what needs attention, and then
 * the lists themselves. Noel's second review (2026-08-19) cut the alert rows
 * that stood between the two: they were cards restating the lists rendered
 * directly below them, and information said twice is not said better. The
 * summary is plain text, not a set of links — the sections underneath are
 * the doors. Scanning is not offered here either: on a phone Escanear is
 * permanently in the bottom bar, and this is the desktop overview, where
 * there is no camera.
 *
 * The data the summary and the lists share (Phase 8 item 2 — a number and
 * the list it describes must come from the same question):
 *
 * - `inventory.getStockOverview` with `needsRestock` — the same question
 *   /inventory?filter=restock asks, so summary and list cannot disagree.
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
 * capped at 100 per page; past that, the summary says so in words rather than
 * quietly rounding — a wrong number is worse than an honest bound.
 */
const OVERVIEW_PAGE_SIZE = 100;

/** How many rows each section shows before it defers to its own page. */
const MAX_ROWS = 5;

export default function DashboardPage(): JSX.Element {
  const t = useTranslations("dashboard");

  // The summary asks the server for the same set the section below shows
  // (`needsRestock`, the filter /inventory?filter=restock uses) — a number
  // and the list it describes must never disagree, because that is how
  // numbers stop being trusted (Phase 8 item 2).
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

  // What needs attention, in one sentence and nothing else. The lists below
  // are the detail *and* the doors; repeating them as linked cards up here
  // was saying everything twice (Noel's review, 2026-08-19). When nothing
  // needs attention the sentence is absent — the sections already say all is
  // well in words.
  const summaryParts: string[] = [];
  if (expiredItems.length > 0) {
    summaryParts.push(t("summaryExpired", { count: expiredItems.length }));
  }
  if (expiringItems.length > 0) {
    summaryParts.push(t("summaryExpiring", { count: expiringItems.length }));
  }
  if (restock.length > 0) {
    summaryParts.push(
      restockIsCapped
        ? t("summaryRestockCapped", { count: restock.length })
        : t("summaryRestock", { count: restock.length }),
    );
  }

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
        <ul className="grid gap-3 md:grid-cols-3">
          <QuickLink href="/inventory/add" label={t("quickAddStock")} primary />
          <QuickLink href="/inventory/consume" label={t("quickConsumeStock")} />
          <QuickLink href="/receipts/upload" label={t("quickUploadReceipt")} />
        </ul>
      </section>

      {summaryParts.length > 0 && (
        <p className="font-medium text-foreground">
          {summaryParts.join(" · ")}
        </p>
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
            {/* A list, not a card: rows separate with dividers, and the box
                that used to frame them is gone (Noel's rule, 2026-08-19 —
                cards only where a card is justified). */}
            <ul className="mt-3 divide-y divide-border">
              {restock.slice(0, MAX_ROWS).map((product) => (
                <li
                  key={product.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
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
              // The overflow is a door, not a shrug: when the panel cannot
              // show everything, this is the way to the full set, asked of
              // the server with the same `needsRestock` question (Phase 8
              // item 2 — the alert row that used to be this door is gone).
              <p className="mt-2 text-sm">
                <Link
                  href="/inventory?filter=restock"
                  className="inline-flex min-h-[48px] items-center text-primary underline underline-offset-4"
                >
                  {t("restockMore", { count: restock.length - MAX_ROWS })}
                </Link>
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
            <ul className="mt-3 divide-y divide-border">
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
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
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
