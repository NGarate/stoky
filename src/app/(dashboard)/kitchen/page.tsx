"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import { Button } from "@/components/ui/button";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemRow } from "@/components/ui/item-row";
import { ExpiryStatus } from "@/components/inventory/ExpiryStatus";
import { StockStatus } from "@/components/inventory/StockStatus";
import { useQuantityFormat } from "@/lib/inventory/quantity";
import { EXPIRING_SOON_DAYS } from "@/lib/inventory/batches";
import { needsMoreOnList } from "@/lib/stock/low-stock";
import { useWriteQueue } from "@/lib/offline/queue-context";
import { UNDO_HOLD_MS } from "@/lib/offline/queue";
import { useSnackbar } from "@/components/ui/snackbar";
import {
  projectOnListQuantities,
  projectStockTotals,
} from "@/lib/offline/project";
import type { JSX } from "react";
import { formatTime } from "@/lib/dates";

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
 * - **Nothing urgent below the fold.** "Usar ya" is first; what follows is
 *   quieter.
 * - **One action per row, one tap each.** A card's tap uses one unit up; a
 *   running-out row's tap writes it on the shopping list — added by the
 *   owner's pass (§4 amendment, D88), which overruled the original "no
 *   creating, no editing". Editing products and stock is still the phone's
 *   job; nothing here opens a form.
 * - **It refreshes itself.** A tablet nobody touches must not show yesterday.
 *
 * **Undo is cancelling the queued change, never a compensating write.** An
 * `addStock` to reverse a `consumeStock` would record that the household
 * acquired something it never did, and every downstream reader — the price
 * history, the expiry view, a future report — would see a fabricated event it
 * cannot tell from a real one. So the undo is offered exactly while the change
 * is still in the queue, and disappears when it can no longer work.
 *
 * **The change is held in the queue for ten seconds** (§4's undo window,
 * D100). Without the hold, "while it is still in the queue" was one network
 * round-trip online — the button flashed for a single render and was gone,
 * which is no undo at all. The hold keeps the two promises aligned: the
 * button shows exactly while pressing it works, and it works for ten seconds.
 *
 * **The button lives in the snackbar, not in the card** (D101). Two things
 * were wrong with it in the card. It moved the layout: a second button
 * appeared under the one just pressed, so the row below jumped down and the
 * next thing to tap was somewhere else — on the tier where taps are least
 * precise. And it put the undo where the eye had just left rather than where
 * the confirmation is, so nothing told a person the tap had registered at all
 * except a number changing somewhere else on the screen.
 *
 * What did not change is the semantics. The hold is still ten seconds, undo is
 * still `queue.cancel`, and the affordance still exists exactly as long as
 * pressing it works — the snackbar takes its lifetime from the queue rather
 * than from a timer of its own.
 */
export default function KitchenPage(): JSX.Element {
  const t = useTranslations("kitchen");
  const locale = useLocale();
  const units = useQuantityFormat();
  const { state: queue, enqueue } = useWriteQueue();
  const snackbar = useSnackbar();

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
  // The open lists, newest first — "Apuntar" writes to the newest one, and
  // when none exists the first tap creates one (D97). `shopping.create` is
  // not offline-replayable, so that first tap is online-only and says so
  // rather than failing quietly.
  const lists = api.shopping.list.useQuery({}, { refetchInterval });
  const [listError, setListError] = useState(false);
  const utils = api.useUtils();
  /**
   * Taps waiting for the first list, and that list once it exists.
   *
   * With no list, the first tap creates one — and every tap after it, until
   * the list query caught up, saw no list either and created another. Quick
   * taps on a tablet left a household with several "Lista de la cocina".
   * Taps made while the list is being created now wait for it and land on
   * it; the created id is kept so the gap before the list query refetches
   * cannot open the door again.
   */
  const waitingForList = useRef<Array<{ id: string; name: string; defaultUnit: string }> | null>(null);
  const createdListId = useRef<string | null>(null);
  const createList = api.shopping.create.useMutation({
    onError: () => {
      waitingForList.current = null;
      setListError(true);
    },
  });

  if (!expiring.data) {
    return (
      <RouteState
        error={expiring.error}
        fetchStatus={expiring.fetchStatus}
        isLoading={expiring.isPending}
        density="touch"
        onRetry={() => void expiring.refetch()}
        title={t("title")}
        width="screen"
      />
    );
  }

  const batches = expiring.data;
  const urgent = batches.filter(
    (batch) => batch.daysUntilExpiry <= EXPIRING_SOON_DAYS,
  );
  const later = batches.filter(
    (batch) => batch.daysUntilExpiry > EXPIRING_SOON_DAYS,
  );

  const lowStock = stock.data?.products ?? [];
  /**
   * Whether the section can answer at all.
   *
   * `lowStock` falls back to an empty array, and an empty array rendered
   * "No falta nada" — so a failed or unanswered query told a household
   * everything was in stock. On a tablet propped up in a kitchen and read
   * from a metre away that is the worst shape a failure can take: it looks
   * exactly like good news, and nobody goes to check.
   *
   * Stale data still counts as an answer: a five-minute-old list of what is
   * running low is worth more than a failure panel over it.
   */
  const restock = stock.data ? "ready" : stock.error ? "failed" : "checking";
  // What the lists already cover, with anything tapped but not yet sent
  // folded in — the same reason the totals are projected rather than read.
  const onList = projectOnListQuantities(
    new Map(lowStock.map((product) => [product.id, product.onListQuantity])),
    queue.pending,
  );
  const totals = projectStockTotals(
    new Map(lowStock.map((product) => [product.id, product.totalStock])),
    queue.pending,
  );

  function enqueueAdd(
    listId: string,
    product: { id: string; name: string; defaultUnit: string },
  ): void {
    const label = {
      key: "offline.addedItem",
      values: { name: product.name },
    };
    const queued = enqueue({
      path: "shopping.addItem",
      input: {
        shoppingListId: listId,
        productId: product.id,
        quantity: 1,
        unit: product.defaultUnit,
      },
      label,
      holdMs: UNDO_HOLD_MS,
    });

    // Refused for want of room: the queue is full and says so in the shell's
    // own banner, which is a state rather than an event. Claiming the item
    // was added would be a lie.
    if (!queued.ok) return;

    snackbar.show({
      kind: "undo-queued",
      message: label,
      opId: queued.id,
    });
  }

  function addToList(product: {
    id: string;
    name: string;
    defaultUnit: string;
  }): void {
    setListError(false);
    const target = lists.data?.[0]?.id ?? createdListId.current;
    if (target) {
      enqueueAdd(target, product);
      return;
    }
    // Already creating it: this tap waits for that list rather than asking
    // for another.
    if (waitingForList.current !== null) {
      waitingForList.current.push(product);
      return;
    }
    // No list yet: the tap creates one and writes the first item on it. Two
    // steps, one gesture — a person at the tablet asked for neither a form
    // nor a decision about names.
    waitingForList.current = [product];
    createList.mutate(
      { name: t("listName") },
      {
        onSuccess: async (created) => {
          createdListId.current = created.id;
          const waiting = waitingForList.current ?? [];
          waitingForList.current = null;
          for (const each of waiting) enqueueAdd(created.id, each);
          await utils.shopping.list.invalidate();
        },
      },
    );
  }

  function batchLeft(batch: (typeof batches)[number]): number | null {
    if (batch.quantity === null) return null;
    const used = queue.pending.reduce((sum, op) => {
      const input = op.input as { batchId?: string; quantity?: number };
      return op.path === "inventory.consumeStock" && input.batchId === batch.id
        ? sum + (input.quantity ?? 0) : sum;
    }, 0);
    return Math.max(0, batch.quantity - used);
  }

  function useOne(batch: (typeof batches)[number]): void {
    const left = batchLeft(batch);
    if (left === null || left < 1) return;
    const label = {
      key: "offline.usedUp",
      values: { quantity: 1, unit: batch.unit, name: batch.product.name },
    };
    const queued = enqueue({
      path: "inventory.consumeStock",
      input: {
        productId: batch.product.id,
        batchId: batch.id,
        quantity: 1,
        unit: batch.unit,
      },
      label,
      holdMs: UNDO_HOLD_MS,
    });

    if (!queued.ok) return;

    snackbar.show({
      kind: "undo-queued",
      message: label,
      opId: queued.id,
    });
  }

  return (
    <PageShell width="screen">
      <PageHeader density="touch" title={t("title")} />

      <section aria-labelledby="use-now">
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
              return (
                <li
                  key={batch.id}
                  className="rounded-xl border border-warn-foreground bg-warn p-5"
                >
                  <p className="text-2xl font-bold text-warn-foreground">
                    {batch.product.name}
                  </p>
                  {/* `ExpiryStatus`'s word, the one every screen uses. This
                      said "Quedan 2 días" while the Panel said "En 2 días"
                      for the same batch. Outlined: the card is already warn. */}
                  <p className="mt-2">
                    <ExpiryStatus
                      className="text-xl"
                      daysUntilExpiry={batch.daysUntilExpiry}
                      onTintedRow
                    />
                  </p>
                  <p className="mt-1 text-xl text-warn-foreground">
                    {batch.location?.name ?? t("noLocation")}
                  </p>

                  <p className="mt-1 text-xl text-warn-foreground">
                    {batchLeft(batch) === null ? t("quantityUnknown") : t("batchLeft", { quantity: batchLeft(batch) ?? 0, unit: units.unit(batch.unit, batchLeft(batch) ?? 0) })}
                  </p>
                  <Button
                    disabled={batchLeft(batch) === null || (batchLeft(batch) ?? 0) < 1}
                    className="mt-4 w-full text-xl"
                    onClick={() => useOne(batch)}
                    size="lg"
                    type="button"
                  >
                    <span aria-hidden="true">{t("useOneUnit", { unit: units.unit(batch.unit, 1) })}</span>
                    <span className="sr-only">
                      {t("useOneOf", {
                        unit: units.unit(batch.unit, 1),
                        name: batch.product.name,
                      })}
                    </span>
                  </Button>
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
            <EmptyState className="mt-3" density="touch" title={t("nothingThisWeek")} />
          ) : (
            <ul className="mt-3">
              {later.map((batch) => (
                <ItemRow
                  density="touch"
                  key={batch.id}
                  status={
                    <ExpiryStatus
                      className="text-lg md:text-xl"
                      daysUntilExpiry={batch.daysUntilExpiry}
                    />
                  }
                  title={batch.product.name}
                  variant="plain"
                />
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
          {/* Announced politely: the one failure this section can produce is
              "no connection to create the first list", and a tablet read from
              a metre away must say it rather than swallow the tap. */}
          <p
            aria-live="polite"
            className={listError ? "mt-3 text-lg text-danger-foreground" : "sr-only"}
            role="status"
          >
            {listError ? t("listCreateFailed") : ""}
          </p>
          {restock === "failed" ? (
            <div className="mt-3">
              <p className="text-xl text-danger-foreground">
                {t("runningOutFailed")}
              </p>
              <Button
                className="mt-2"
                onClick={() => void stock.refetch()}
                type="button"
                variant="outline"
              >
                {t("runningOutRetry")}
              </Button>
            </div>
          ) : restock === "checking" ? (
            <p className="mt-3 text-xl text-muted-foreground">
              {t("runningOutLoading")}
            </p>
          ) : lowStock.length === 0 ? (
            <EmptyState className="mt-3" density="touch" title={t("nothingRunningOut")} />
          ) : (
            <ul className="mt-3">
              {lowStock.map((product) => {
                const left = totals.get(product.id) ?? product.totalStock;
                const already = onList.get(product.id) ?? 0;
                return (
                  <ItemRow
                    density="touch"
                    key={product.id}
                    meta={[
                      {
                        // The label says "Queda"; the value used to say it
                        // again — "Queda / Queda 1 de 2 L", and "Queda / No
                        // queda nada" — which on a tablet read from a metre
                        // away is a word of the sentence spent twice. At
                        // zero it is the amount like any other: what that
                        // *means* is the status badge's job.
                        label: t("leftLabel"),
                        value: t("leftOf", {
                          stock: Math.max(0, left),
                          minimum: product.minStock ?? 0,
                          unit: units.unit(product.defaultUnit, product.minStock ?? 0),
                        }),
                      },
                    ]}
                    /* StockStatus's word, the one the inventory and the Panel
                       wear. This row worked the state out for itself — "Queda:
                       Nada" and no badge — which is ISSUES UI-11 on a sixth
                       screen. Every row here came from the `lowStock`
                       question, so each is low by construction. */
                    status={
                      <StockStatus
                        className="text-lg md:text-xl"
                        isLowStock
                        totalStock={left}
                      />
                    }
                    actions={
                      /* Offered only while it would change anything. Six
                         litres already written down and a minimum of six is
                         not a product that needs buying, and a button that
                         stays lit on a tablet read from a metre away is a
                         button somebody presses again. What replaces it is
                         the reason, not a blank. */
                      needsMoreOnList(left, already, product.minStock) ? (
                        // In `actions`, not `status`: beside the title it
                        // moved with the length of the product's name, at
                        // `text-sm`, on a screen read from a metre away. Same
                        // size as the cards' "He usado" button.
                        <Button
                          className="text-xl"
                          onClick={() => addToList(product)}
                          size="lg"
                          type="button"
                          variant="outline"
                        >
                          <span aria-hidden="true">{t("addToList")}</span>
                          <span className="sr-only">
                            {t("addToListOf", { name: product.name })}
                          </span>
                        </Button>
                      ) : (
                        <p className="text-lg text-muted-foreground md:text-xl">
                          {t("onList", {
                            quantity: already,
                            unit: units.unit(product.defaultUnit, already),
                          })}
                        </p>
                      )
                    }
                    title={product.name}
                    variant="plain"
                  />
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* A tablet nobody touches refreshes itself every five minutes; this
          is how a person reading it from across the room can tell it did.
          Not live: announcing the clock every five minutes would be noise. */}
      {expiring.dataUpdatedAt > 0 ? (
        <p className="mt-10 text-lg text-muted-foreground">
          {t("updated", {
            time: formatTime(locale, expiring.dataUpdatedAt),
          })}
        </p>
      ) : null}
    </PageShell>
  );
}
