"use client";

import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";

import { useWriteQueue } from "@/components/offline/queue-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  };
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
export function ShoppingItem({ item }: ShoppingItemProps): JSX.Element {
  const t = useTranslations("shopping");
  const { enqueue } = useWriteQueue();

  const name = item.product?.name || t("itemName");

  return (
    <ItemRow
      actions={
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
      }
      density="touch"
      meta={[
        { label: t("quantityLabel"), value: `${item.quantity} ${item.unit ?? ""}`.trim() },
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
