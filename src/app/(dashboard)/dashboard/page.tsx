"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { ExpiryRow } from "@/components/inventory/ExpiryStatus";
import { StockStatus } from "@/components/inventory/StockStatus";
import { useQuantityFormat } from "@/lib/inventory/quantity";
import { Button } from "@/components/ui/button";
import { ItemRow } from "@/components/ui/item-row";
import { api } from "@/lib/trpc/client";
import { RouteState, SectionState } from "@/components/household/RouteState";
import type { JSX } from "react";

/**
 * Household overview — the screen every login lands on.
 *
 * It opens with the quick actions, because whoever lands here came to *do*
 * something — then the lists themselves. Noel's second review (2026-08-19)
 * cut the alert rows that stood between the two: they were cards restating
 * the lists rendered directly below them. The third review cut the sentence
 * that replaced them for the same reason — "3 productos por reponer" above a
 * section headed "Necesita reposición" listing three products is the count
 * said twice, and the section was always the door. Scanning is not offered
 * here either: on a phone Escanear is permanently in the bottom bar, and this
 * is the desktop overview, where there is no camera.
 *
 * What it asks for:
 *
 * - `inventory.getStockOverview` with `needsRestock` — the same question
 *   /inventory?filter=restock asks, so this list and that one cannot disagree.
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
 * One page of the restock list. `getStockOverview` is capped at 100 per page;
 * past that the section shows its first rows and defers to
 * /inventory?filter=restock, which is where the whole set lives.
 */
const OVERVIEW_PAGE_SIZE = 100;

/** How many rows each section shows before it defers to its own page. */
const MAX_ROWS = 5;

export default function DashboardPage(): JSX.Element {
  const t = useTranslations("dashboard");
  const units = useQuantityFormat();

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

  /**
   * Gated on the data the page is built from, not on what every query is
   * doing.
   *
   * It used to wait for all three to stop being pending, and
   * `getExpiredItems` was not persisted — so offline it was pending for ever
   * and the screen said "loading" over a restock list it already had. And any
   * error replaced the page, so one background refetch failing took a loaded
   * panel away. The restock list is the page: without it, RouteState says
   * which of loading, offline, failed or no-household it is (by the server's
   * code, where this used to look for "household" in the message text).
   */
  if (!restockRows) {
    return (
      <RouteState
        error={restockQuery.error}
        fetchStatus={restockQuery.fetchStatus}
        isLoading={restockQuery.isPending}
        onRetry={() => void restockQuery.refetch()}
        title={t("title")}
      />
    );
  }

  // The expiry section needs both answers before it can say anything is or is
  // not about to go off. Without one it says why, rather than `data ?? []`
  // turning a failure into "nothing at risk".
  const expiryUnanswered = !expiring.data
    ? expiring
    : !expired.data
      ? expired
      : null;
  const expiredItems = expired.data ?? [];
  const expiringItems = expiring.data ?? [];
  const atRisk = expiredItems.length + expiringItems.length;

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

      <section aria-labelledby="dashboard-restock">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="dashboard-restock"
            className="text-lg font-semibold text-heading"
          >
            {t("restockTitle")}
          </h2>
          <Button asChild variant="link">
              <Link href="/shopping">{t("restockListLink")}</Link>
            </Button>
        </div>

        {restock.length === 0 ? (
          <p className="mt-2 text-muted-foreground">{t("restockEmpty")}</p>
        ) : (
          <>
            {/* A list, not a card: rows separate with dividers, and the box
                that used to frame them is gone (Noel's rule, 2026-08-19 —
                cards only where a card is justified). */}
            <ul className="mt-3">
              {restock.slice(0, MAX_ROWS).map((product) => (
                <ItemRow
                  density="compact"
                  href={`/products/${product.id}`}
                  key={product.id}
                  // How much is left is a detail, so it is meta; the state is
                  // StockStatus's word, the same one the inventory wears. This
                  // derived its own — "Quedan 1 paquete (mínimo 2)" in a warn
                  // badge here, "Stock bajo" there — which is ISSUES UI-11
                  // arriving on a fifth screen.
                  meta={
                    product.totalStock > 0
                      ? [
                          {
                            label: t("restockAmountLabel"),
                            value: t("restockLow", {
                              quantity: product.totalStock,
                              minimum: product.minStock ?? 0,
                              unit: units.unit(
                                product.defaultUnit,
                                product.totalStock,
                              ),
                            }),
                          },
                        ]
                      : undefined
                  }
                  status={
                    <StockStatus
                      isLowStock={product.isLowStock}
                      totalStock={product.totalStock}
                    />
                  }
                  title={product.name}
                  variant="plain"
                />
              ))}
            </ul>
            {restock.length > MAX_ROWS ? (
              // The overflow is a door, not a shrug: when the panel cannot
              // show everything, this is the way to the full set, asked of
              // the server with the same `needsRestock` question (Phase 8
              // item 2 — the alert row that used to be this door is gone).
              <Button asChild className="mt-2" variant="link">
                <Link href="/inventory?filter=restock">
                  {t("restockMore", { count: restock.length - MAX_ROWS })}
                </Link>
              </Button>
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
          <Button asChild variant="link">
              <Link href="/inventory">{t("expiryInventoryLink")}</Link>
            </Button>
        </div>

        {expiryUnanswered !== null ? (
          <SectionState
            error={expiryUnanswered.error}
            fetchStatus={expiryUnanswered.fetchStatus}
            onRetry={() => void expiryUnanswered.refetch()}
          />
        ) : atRisk === 0 ? (
          <p className="mt-2 text-muted-foreground">{t("expiryEmpty")}</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border">
              {expiredItems.slice(0, MAX_ROWS).map((item) => (
                <ExpiryRow
                  batch={item}
                  daysUntilExpiry={-item.daysExpired}
                  key={item.id}
                />
              ))}
              {expiringItems.slice(0, MAX_ROWS).map((item) => (
                <ExpiryRow
                  batch={item}
                  daysUntilExpiry={item.daysUntilExpiry}
                  key={item.id}
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
      <Button
        asChild
        className="w-full"
        variant={primary ? "default" : "outline"}
      >
        <Link href={href}>
          {label}
        </Link>
      </Button>
    </li>
  );
}
