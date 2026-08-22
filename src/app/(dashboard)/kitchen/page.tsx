"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { RouteState } from "@/components/household/RouteState";
import { Button } from "@/components/ui/button";
import { ItemRow } from "@/components/ui/item-row";
import { needsMoreOnList } from "@/lib/stock/low-stock";
import { useWriteQueue } from "@/components/offline/queue-context";
import { useSnackbar } from "@/components/ui/snackbar";
import {
  projectOnListQuantities,
  projectStockTotals,
} from "@/lib/offline/project";
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
/**
 * How long a tap can be taken back, and therefore how long it waits before
 * being sent. §4 asked for ten seconds; long enough to read the button from a
 * metre away and cross the kitchen, short enough that the change still lands
 * while the person is standing there.
 */
const UNDO_HOLD_MS = 10_000;

export default function KitchenPage(): JSX.Element {
  const t = useTranslations("kitchen");
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
  const createList = api.shopping.create.useMutation({
    onError: () => setListError(true),
  });

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
    const target = lists.data?.[0];
    if (target) {
      enqueueAdd(target.id, product);
      return;
    }
    // No list yet: the tap creates one and writes the first item on it. Two
    // steps, one gesture — a person at the tablet asked for neither a form
    // nor a decision about names.
    createList.mutate(
      { name: t("listName") },
      {
        onSuccess: async (created) => {
          enqueueAdd(created.id, product);
          await utils.shopping.list.invalidate();
        },
      },
    );
  }

  function useOne(batch: (typeof batches)[number]): void {
    const label = {
      key: "offline.usedUp",
      values: { quantity: 1, unit: batch.unit, name: batch.product.name },
    };
    const queued = enqueue({
      path: "inventory.consumeStock",
      input: {
        productId: batch.product.id,
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

                  <Button
                    className="mt-4 w-full text-xl"
                    onClick={() => useOne(batch)}
                    size="lg"
                    type="button"
                  >
                    <span aria-hidden="true">{t("useOne")}</span>
                    <span className="sr-only">
                      {t("useOneOf", {
                        unit: batch.unit,
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
            <p className="mt-3 text-xl text-muted-foreground">
              {t("nothingThisWeek")}
            </p>
          ) : (
            <ul className="mt-3">
              {later.map((batch) => (
                <ItemRow
                  density="touch"
                  key={batch.id}
                  status={
                    <span className="shrink-0 text-muted-foreground">
                      {when(batch.daysUntilExpiry)}
                    </span>
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
            <p className="mt-3 text-xl text-muted-foreground">
              {t("nothingRunningOut")}
            </p>
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
                        label: t("leftLabel"),
                        value:
                          left <= 0
                            ? t("noneLeft")
                            : t("leftOf", {
                                stock: left,
                                minimum: product.minStock ?? 0,
                                unit: product.defaultUnit,
                              }),
                      },
                    ]}
                    status={
                      /* Offered only while it would change anything. Six
                         litres already written down and a minimum of six is
                         not a product that needs buying, and a button that
                         stays lit on a tablet read from a metre away is a
                         button somebody presses again. What replaces it is
                         the reason, not a blank. */
                      needsMoreOnList(left, already, product.minStock) ? (
                        <Button
                          onClick={() => addToList(product)}
                          type="button"
                          variant="outline"
                        >
                          <span aria-hidden="true">{t("addToList")}</span>
                          <span className="sr-only">
                            {t("addToListOf", { name: product.name })}
                          </span>
                        </Button>
                      ) : (
                        <span className="shrink-0 text-lg text-muted-foreground">
                          {t("onList", {
                            quantity: already,
                            unit: product.defaultUnit,
                          })}
                        </span>
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
    </div>
  );
}
