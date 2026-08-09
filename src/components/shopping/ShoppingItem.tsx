"use client";

import { useTranslations } from "next-intl";
import { api } from "@/lib/trpc/client";

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
  listId: string;
}

export function ShoppingItem({ item, listId }: ShoppingItemProps) {
  const t = useTranslations("shopping");
  const utils = api.useUtils();

  const toggleMutation = api.shopping.updateItem.useMutation({
    onSuccess: () => {
      utils.shopping.getById.invalidate({ id: listId });
      utils.shopping.list.invalidate();
    },
  });

  const deleteMutation = api.shopping.removeItem.useMutation({
    onSuccess: () => {
      utils.shopping.getById.invalidate({ id: listId });
      utils.shopping.list.invalidate();
    },
  });

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
            toggleMutation.mutate({
              id: item.id,
              isChecked: !item.isChecked,
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
        onClick={() => deleteMutation.mutate({ id: item.id })}
        disabled={deleteMutation.isPending}
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
