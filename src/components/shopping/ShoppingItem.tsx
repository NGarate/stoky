"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useId } from "react";
import { Trash2 } from "lucide-react";

import { useWriteQueue } from "@/components/offline/queue-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemRow } from "@/components/ui/item-row";

import type { JSX } from "react";

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
 * removal here is a removal.
 */
export function ShoppingItem({
  item,
  canWrite,
  stores,
}: ShoppingItemProps): JSX.Element {
  const t = useTranslations("shopping");
  const { enqueue } = useWriteQueue();
  const quantityId = useId();
  const storeId = useId();

  const name = item.product?.name || t("itemName");

  /** Both controls write the same way the tick does: through the queue. */
  function change(
    input: { quantity: number } | { storeId: string | null },
  ): void {
    enqueue({
      path: "shopping.updateItem",
      input: { id: item.id, ...input },
      label: { key: "shopping.itemUpdated", values: { name } },
    });
  }

  return (
    <ItemRow
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
          <Button
            aria-label={t("removeItem")}
            onClick={() =>
              enqueue({
                path: "shopping.removeItem",
                input: { id: item.id },
                label: { key: "offline.removedItem", values: { name } },
              })
            }
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" className="h-5 w-5 text-destructive" />
          </Button>
        </>
      }
      density="touch"
      meta={[
        {
          label: t("quantityLabel"),
          value: canWrite ? (
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
                  if (Number.isFinite(next) && next > 0 && next !== item.quantity) {
                    change({ quantity: next });
                  }
                }}
                step="any"
                type="number"
              />
              <span>{item.unit ?? ""}</span>
            </div>
          ) : (
            `${item.quantity} ${item.unit ?? ""}`.trim()
          ),
        },
        {
          label: t("storeLabel"),
          value: canWrite ? (
            <>
              <label className="sr-only" htmlFor={storeId}>
                {t("storeOf", { name })}
              </label>
              <select
                className="min-h-[48px] w-full rounded-md border border-input bg-card px-3 text-foreground"
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
              </select>
            </>
          ) : (
            (item.store?.name ?? t("storeAnywhere"))
          ),
        },
      ]}
      status={
        <label className="flex min-h-[48px] items-center gap-2 text-lg">
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
          {item.isChecked ? (
            <Badge tone="ok">{t("bought")}</Badge>
          ) : null}
        </label>
      }
      title={
        <span className={item.isChecked ? "text-muted-foreground line-through" : ""}>
          {name}
        </span>
      }
    />
  );
}
