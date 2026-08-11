"use client";

import { useTranslations } from "next-intl";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import { useWriteQueue } from "@/components/offline/queue-context";
import { projectStockTotals } from "@/lib/offline/project";
import type { JSX } from "react";

/**
 * Screen B — the kitchen, "at home" (`REDESIGN_PLAN.md` §4).
 *
 * Anyone in the house, in passing, reading from a metre away. An old tablet
 * propped up, possibly untouched for days. It answers one question: *what
 * should we eat before it goes off?*
 *
 * The decisions §4 makes, and where each one shows:
 *
 * - **Readable at a metre.** Body text is `text-xl`/`text-2xl` and headings
 *   `text-4xl`+, rather than the dashboard's defaults.
 * - **Nothing urgent below the fold.** "Usar ya" is first and is the only
 *   section with buttons; the two columns below it are for reading.
 * - **One button per card, and nothing else.** No creating, no editing — that
 *   is the phone's job. A tap uses one unit up.
 * - **It refreshes itself.** A tablet nobody touches must not show yesterday.
 *
 * **Undo is cancelling the queued change, never a compensating write.** An
 * `addStock` to reverse a `consumeStock` would record that the household
 * acquired something it never did, and every downstream reader — the price
 * history, the expiry view, a future report — would see a fabricated event it
 * cannot tell from a real one. So the undo is offered exactly while the change
 * is still in the queue, and disappears when it can no longer work. That is
 * more honest than a ten-second timer, which offers undo for ten seconds
 * whether or not it would do anything.
 */
export default function KitchenPage(): JSX.Element {
  const t = useTranslations("kitchen");
  const { state: queue, enqueue, cancel } = useWriteQueue();

  // A tablet nobody touches must not show yesterday's answer. Long enough not
  // to be a load on a self-hosted box, short enough that "3 days" is true.
  const refetchInterval = 5 * 60 * 1000;

  const expiring = api.inventory.getExpiringItems.useQuery(
    { days: 7 },
    { refetchInterval },
  );
  const stock = api.inventory.getStockOverview.useQuery(
    { limit: 100, lowStock: true },
    { refetchInterval },
  );

  if (!expiring.data) {
    return (
      <RouteState
        error={expiring.error}
        fetchStatus={expiring.fetchStatus}
        isLoading={expiring.isPending}
        onRetry={() => void expiring.refetch()}
        title={t("title")}
      />
    );
  }

  const batches = expiring.data;
  const urgent = batches.filter((batch) => batch.daysUntilExpiry <= 3);
  const later = batches.filter((batch) => batch.daysUntilExpiry > 3);

  const lowStock = stock.data?.products ?? [];
  const totals = projectStockTotals(
    new Map(lowStock.map((product) => [product.id, product.totalStock])),
    queue.pending,
  );

  /** The queued change for this product, if one is still waiting. */
  function pendingUse(productId: string): string | null {
    const op = queue.pending.find(
      (entry) =>
        entry.path === "inventory.consumeStock" &&
        (entry.input as { productId?: unknown }).productId === productId,
    );
    return op?.id ?? null;
  }

  function useOne(batch: (typeof batches)[number]): void {
    enqueue({
      path: "inventory.consumeStock",
      input: {
        productId: batch.product.id,
        quantity: 1,
        unit: batch.unit,
      },
      label: {
        key: "offline.usedUp",
        values: { quantity: 1, unit: batch.unit, name: batch.product.name },
      },
    });
  }

  function when(days: number): string {
    if (days < 0) return t("expired");
    if (days === 0) return t("expiresToday");
    if (days === 1) return t("expiresTomorrow");
    return t("expiresInDays", { days });
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-4xl font-bold text-heading">{t("title")}</h1>

      <section aria-labelledby="use-now" className="mt-8">
        <h2
          className="text-2xl font-semibold uppercase tracking-wide text-muted-foreground"
          id="use-now"
        >
          {t("useNow")}
        </h2>

        {urgent.length === 0 ? (
          <div className="mt-4 rounded-xl border border-ok-foreground bg-ok p-6">
            <p className="text-2xl text-ok-foreground">{t("nothingUrgent")}</p>
            <p className="mt-2 text-xl text-ok-foreground">
              {t("nothingUrgentHint")}
            </p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {urgent.map((batch) => {
              const queued = pendingUse(batch.product.id);
              return (
                <li
                  key={batch.id}
                  className="rounded-xl border border-warn-foreground bg-warn p-5"
                >
                  <p className="text-2xl font-bold text-warn-foreground">
                    {batch.product.name}
                  </p>
                  <p className="mt-1 text-xl text-warn-foreground">
                    {when(batch.daysUntilExpiry)}
                  </p>
                  <p className="mt-1 text-xl text-warn-foreground">
                    {batch.location?.name ?? t("noLocation")}
                  </p>

                  <button
                    className="mt-4 min-h-[64px] w-full rounded-lg bg-primary px-4 py-3 text-xl font-semibold text-primary-foreground hover:bg-primary/90"
                    onClick={() => useOne(batch)}
                    type="button"
                  >
                    <span aria-hidden="true">{t("useOne")}</span>
                    <span className="sr-only">
                      {t("useOneOf", {
                        unit: batch.unit,
                        name: batch.product.name,
                      })}
                    </span>
                  </button>

                  {/* Offered exactly while it can still work, which is more
                      honest than a countdown that offers it regardless. */}
                  {queued ? (
                    <button
                      className="mt-2 min-h-[48px] w-full rounded-lg border border-warn-foreground px-4 py-2 text-lg text-warn-foreground"
                      onClick={() => cancel(queued)}
                      type="button"
                    >
                      <span aria-hidden="true">{t("undo")}</span>
                      <span className="sr-only">
                        {t("undoOf", { name: batch.product.name })}
                      </span>
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mt-10 grid gap-8 md:grid-cols-2">
        <section aria-labelledby="this-week">
          <h2
            className="text-2xl font-semibold uppercase tracking-wide text-muted-foreground"
            id="this-week"
          >
            {t("thisWeek")}
          </h2>
          {later.length === 0 ? (
            <p className="mt-3 text-xl text-muted-foreground">
              {t("nothingThisWeek")}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {later.map((batch) => (
                <li
                  key={batch.id}
                  className="flex items-baseline justify-between gap-4 border-b border-border py-2 text-xl"
                >
                  <span className="text-foreground">{batch.product.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {when(batch.daysUntilExpiry)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="running-out">
          <h2
            className="text-2xl font-semibold uppercase tracking-wide text-muted-foreground"
            id="running-out"
          >
            {t("runningOut")}
          </h2>
          {lowStock.length === 0 ? (
            <p className="mt-3 text-xl text-muted-foreground">
              {t("nothingRunningOut")}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {lowStock.map((product) => {
                const left = totals.get(product.id) ?? product.totalStock;
                return (
                  <li
                    key={product.id}
                    className="flex items-baseline justify-between gap-4 border-b border-border py-2 text-xl"
                  >
                    <span className="text-foreground">{product.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {left <= 0
                        ? t("noneLeft")
                        : t("leftOf", {
                            stock: left,
                            minimum: product.minStock ?? 0,
                            unit: product.defaultUnit,
                          })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
