"use client";

import { useTranslations } from "next-intl";
import { useWriteQueue } from "@/components/offline/WriteQueueProvider";

interface ShoppingItemProps {
  item: {
    id: string;
    productId: string | null;
    product?: { name: string } | null;
    customName: string | null;
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
 */
export function ShoppingItem({ item }: ShoppingItemProps) {
  const t = useTranslations("shopping");
  const { enqueue } = useWriteQueue();

  const name = item.product?.name || item.customName || t("itemName");

  return (
    <div
      className={`flex items-center justify-between rounded-lg border p-3 ${
        item.isChecked ? "border-border bg-muted" : "border-border bg-card"
      }`}
    >
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={item.isChecked}
          onChange={() =>
            enqueue({
              path: "shopping.updateItem",
              input: { id: item.id, isChecked: !item.isChecked },
              label: {
                key: item.isChecked ? "offline.untickedOff" : "offline.tickedOff",
                values: { name },
              },
            })
          }
          className="h-5 w-5 rounded border-input accent-primary"
        />
        <div>
          <p
            className={`font-medium ${
              item.isChecked ? "text-muted-foreground line-through" : "text-foreground"
            }`}
          >
            {name}
          </p>
          <p className="text-sm text-muted-foreground">
            {item.quantity} {item.unit}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          enqueue({
            path: "shopping.removeItem",
            input: { id: item.id },
            label: { key: "offline.removedItem", values: { name } },
          })
        }
        className="rounded-md p-2 text-destructive hover:bg-danger disabled:opacity-50"
        aria-label={t("removeItem")}
      >
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <title>Eliminar</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
