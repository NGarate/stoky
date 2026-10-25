"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useId } from "react";
import { Trash2 } from "lucide-react";

import { Select } from "@/components/ui/select";
import { useWriteQueue } from "@/lib/offline/queue-context";
import { undoHoldMs } from "@/lib/snackbar-duration";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemRow } from "@/components/ui/item-row";
import { useSnackbar } from "@/components/ui/snackbar";

import type { JSX } from "react";
import { useQuantityFormat } from "@/lib/inventory/quantity";

interface ShoppingItemProps {
  item: {
    id: string;
    productId: string | null;
    product?: { name: string } | null;
    quantity: number;
    unit: string | null;
    isChecked: boolean;
    storeId?: string | null;
    store?: { id: string; name: string } | null;
    /**
     * An addition still in the queue, whose `id` is the queued change's
     * rather than a row the server knows. See `ProjectedItem.queued`.
     */
    queued?: boolean;
  };
  /**
   * Courtesy only. `shopping.updateItem` is a `writeProcedure`, so a KITCHEN
   * account is refused by the server whatever this renders — D88 widened that
   * role by exactly two capabilities and this is not one of them.
   */
  canWrite: boolean;
  /** The household's shops, for the "where" control. */
  stores: Array<{ id: string; name: string }>;
}

/**
 * A row on the shopping list.
 *
 * **It enqueues; it never mutates directly.** That is the whole of ticking a
 * list off in a supermarket basement: the change is recorded on the device,
 * shown as done immediately, and sent when there is a signal. A `useMutation`
 * here would fail with no connection and the tap would be lost — and having
 * *both* paths would mean two ways to get the same thing wrong.
 *
 * The envelope is added by the sender rather than here, so a change that waits
 * two hours still carries the key it was minted with.
 *
 * Drawn with `ItemRow` at `touch` density, like every other list in the
 * application and at the size the two hand-held screens use. What is *not*
 * shared with `/shopping` is D54's trolley: this screen has none, so a
 * removal here is a removal — which is why the bin holds its change for ten
 * seconds and offers to take it back.
 *
 * **The tick is the one write here that says nothing, and that is a
 * decision.** Every other action on this row reports through the snackbar
 * (D101). Ticking does not, because its result is not transient: the row
 * strikes through and gains a badge and stays that way, and the control that
 * did it undoes it. Someone working down a list in a shop ticks continuously,
 * and a stack of confirmations over the bottom of the screen would cover the
 * list they are reading.
 */
export function ShoppingItem({
  item,
  canWrite,
  stores,
}: ShoppingItemProps): JSX.Element {
  const t = useTranslations("shopping");
  const units = useQuantityFormat();
  const { enqueue, cancel } = useWriteQueue();
  const snackbar = useSnackbar();
  const quantityId = useId();
  const storeId = useId();

  const name = item.product?.name || t("itemName");
  /**
   * Whether this row can be written against yet.
   *
   * An addition that has not been sent has no server id: a tick, a quantity
   * or a shop sent with the queued change's id is refused as a row that does
   * not exist, and the change is lost. So those wait until it is sent.
   */
  const editable = canWrite && item.queued !== true;

  /** Both controls write the same way the tick does: through the queue. */
  function change(
    input: { quantity: number } | { storeId: string | null },
  ): void {
    const label = { key: "shopping.itemUpdated", values: { name } };
    const queued = enqueue({
      path: "shopping.updateItem",
      input: {
        id: item.id,
        ...input,
        ...("quantity" in input ? { quantityUnit: item.unit } : {}),
      },
      label,
    });

    // Refused for want of room: the queue is full and says so in the shell's
    // own banner, which is a state rather than an event.
    if (!queued.ok) return;

    // A confirmation without an undo, deliberately. The control keeps the
    // value that was chosen, so the screen already shows the new answer and
    // the way back is to choose again — but a change committed on blur is
    // easy to make without noticing, which is what the confirmation is for.
    snackbar.show({ kind: "confirm", message: label });
  }

  /**
   * Taking the row off the list.
   *
   * Held for ten seconds and undone by cancelling the queued change, which is
   * D57's rule and the same window the kitchen uses. This screen is not
   * Screen A: it has no trolley to hold a removal, so before this the bin was
   * one tap, silent and final. `REDESIGN_PLAN.md` §7 asks for an undo rather
   * than a confirmation, and that only works where an undo exists — so here
   * is one.
   */
  function remove(): void {
    const label = { key: "offline.removedItem", values: { name } };

    // An addition that has not been sent is taken back by not sending it. A
    // removal queued against its id was refused as a row that does not exist
    // — and the addition, still queued ahead of it, put the item on the list
    // anyway. Too late to cancel means it is being sent right now; it becomes
    // a real row in a moment and can be removed like one — which is what the
    // person is told, rather than a tap that did nothing.
    if (item.queued === true) {
      snackbar.show({
        kind: "confirm",
        message: cancel(item.id)
          ? label
          : { key: "offline.removeWhileSending", values: { name } },
      });
      return;
    }

    const queued = enqueue({
      path: "shopping.removeItem",
      input: { id: item.id },
      label,
      holdMs: undoHoldMs(),
    });

    if (!queued.ok) return;

    snackbar.show({ kind: "undo-queued", message: label, opId: queued.id });
  }

  return (
    <ItemRow
      /* `canWrite` reached the quantity and the shop and stopped there, so a
         KITCHEN account was still offered the tick and the bin — two
         controls `writeProcedure` refuses, discovered by pressing one. D88
         widened that role by exactly two capabilities and neither is this;
         `addItem` is `householdProcedure` on purpose, which is why the row
         can be read here at all. */
      actions={
        <>
          {/* Genuine navigation, so a link — the one exception the design
              system's "actions are buttons" rule admits. It is what makes
              choosing a shop above an informed decision rather than a guess:
              the answer to "where is this cheapest" is one tap away, in the
              aisle, which is where the question is asked. */}
          {item.productId ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/prices/${item.productId}`}>
                <span aria-hidden="true">{t("seePricesShort")}</span>
                <span className="sr-only">{t("seePrices", { name })}</span>
              </Link>
            </Button>
          ) : null}
          {canWrite ? (
            /* A word as well as the bin, and the item in the name. It was an
               icon-only control named "Eliminar artículo" on every row, so a
               list read aloud said it ten times and a voice user had nothing
               visible to say. The visible word starts the name (2.5.3). */
            <Button
              aria-label={t("removeItemOf", { name })}
              onClick={remove}
              size="sm"
              type="button"
              variant="destructive-ghost"
            >
              <Trash2 aria-hidden="true" className="mr-1 size-5" />
              {t("removeShort")}
            </Button>
          ) : null}
        </>
      }
      density="touch"
      meta={[
        {
          label: t("quantityLabel"),
          value: editable ? (
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor={quantityId}>
                {t("quantityOf", { name })}
              </label>
              {/* Committed on change rather than on every keystroke: each one
                  is a queued write, and a queue with eight entries for one
                  number is eight round trips. */}
              <Input
                className="w-24"
                defaultValue={item.quantity}
                id={quantityId}
                inputMode="decimal"
                key={item.quantity}
                min="0.1"
                onBlur={(event) => {
                  const next = Number.parseFloat(event.target.value);
                  if (Number.isFinite(next) && next > 0) {
                    if (next !== item.quantity) change({ quantity: next });
                    return;
                  }
                  // A rejected value used to stay on screen. The box is
                  // uncontrolled — `defaultValue` with `key={item.quantity}`
                  // — so typing "0" and looking away left the row reading
                  // "0 L" while the list still said two, and nothing would
                  // correct it until the quantity changed by some other
                  // route. The number a row shows has to be the number the
                  // list holds, so it goes back.
                  event.target.value = String(item.quantity);
                }}
                step="any"
                type="number"
              />
              <span>{units.unit(item.unit, item.quantity)}</span>
            </div>
          ) : (
            units.quantity(item.quantity, item.unit)
          ),
        },
        {
          label: t("storeLabel"),
          value: editable ? (
            <>
              <label className="sr-only" htmlFor={storeId}>
                {t("storeOf", { name })}
              </label>
              <Select
                id={storeId}
                onChange={(event) =>
                  change({ storeId: event.target.value || null })
                }
                value={item.storeId ?? ""}
              >
                <option value="">{t("storeAnywhere")}</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </Select>
            </>
          ) : (
            (item.store?.name ?? t("storeAnywhere"))
          ),
        },
      ]}
      /* `min-w` as well as `min-h`: the label is the tick's real target, and
         with nothing but a 24px checkbox in it — which is every unticked row —
         it was 24px wide and 48px tall. The same half-target `ItemRow`'s title
         had. The badge widens it once the row is ticked, which is why only the
         unticked rows failed. */
      status={
        item.queued === true ? (
          /* Not a tick yet: there is nothing on the server to tick. Said in
             words, because a missing checkbox on its own says nothing. */
          <Badge tone="neutral">{t("notSentYet")}</Badge>
        ) : canWrite ? (
          <label className="flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 text-lg">
            <input
              checked={item.isChecked}
              className="h-6 w-6 rounded border-input accent-primary"
              onChange={() =>
                enqueue({
                  path: "shopping.updateItem",
                  input: { id: item.id, isChecked: !item.isChecked },
                  label: {
                    key: item.isChecked
                      ? "offline.untickedOff"
                      : "offline.tickedOff",
                    values: { name },
                  },
                })
              }
              type="checkbox"
            />
            <span className="sr-only">
              {item.isChecked ? t("untick", { name }) : t("tickOff", { name })}
            </span>
            {item.isChecked ? <Badge tone="ok">{t("bought")}</Badge> : null}
          </label>
        ) : (
          /* The same fact without the control: a reader who cannot tick it
             off still needs to know whether it has been. */
          <Badge tone={item.isChecked ? "ok" : "neutral"}>
            {item.isChecked ? t("bought") : t("toBuy")}
          </Badge>
        )
      }
      title={
        <span
          className={item.isChecked ? "text-muted-foreground line-through" : ""}
        >
          {name}
        </span>
      }
    />
  );
}
