"use client";

import React, { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProductPicker, type PickedProduct } from "@/components/inventory/ProductPicker";
import { CreateProductInline } from "@/components/receipt/CreateProductInline";
import { api } from "@/lib/trpc/client";
import { ShoppingItem } from "@/components/shopping/ShoppingItem";
import { RouteState, isNotFoundError } from "@/components/household/RouteState";
import { useWriteQueue } from "@/lib/offline/queue-context";
import { useSnackbar } from "@/components/ui/snackbar";
import { projectShoppingItems } from "@/lib/offline/project";

/** The same window the kitchen and the row's bin use (D100). */
const UNDO_HOLD_MS = 10_000;

interface ShoppingListPageProps {
  params: Promise<{ id: string }>;
}

/**
 * The route, which exists only to unwrap its params.
 *
 * The screen is a separate component taking a plain `id`, because
 * `React.use(promise)` never resumes under the component tier's runtime —
 * Suspense holds its fallback for ever — and a screen that can only be
 * exercised by a browser is a screen whose states go unchecked. The split
 * costs one component and buys the four tests below it.
 */
export default function ShoppingListPage({ params }: ShoppingListPageProps) {
  const { id } = React.use(params);
  return <ShoppingListView id={id} />;
}

export function ShoppingListView({ id }: { id: string }) {
  const t = useTranslations();
  const [isAdding, setIsAdding] = useState(false);
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState({ quantity: 1, unit: "" });

  const listQuery = api.shopping.getById.useQuery({ id });
  // One query for the whole list rather than one per row.
  const storesQuery = api.store.list.useQuery({ limit: 100 });
  const me = api.auth.me.useQuery(undefined, { retry: false });
  const stores = storesQuery.data ?? [];
  // `writeProcedure` admits OWNER, ADMIN and MEMBER; KITCHEN reads only
  // (D88 widened it by exactly two capabilities, and editing is not one).
  // The server is the control; hiding the controls is courtesy.
  const canWrite = me.data?.role !== "KITCHEN" && me.data?.role !== undefined;
  const list = listQuery.data;

  const { state: queueState, enqueue } = useWriteQueue();
  const snackbar = useSnackbar();

  const quantityId = useId();
  const unitId = useId();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The opener is an ordinary button rather than a Radix trigger, so the
  // dialog is told by hand where to put focus back.
  const deleteRef = useRef<HTMLButtonElement>(null);

  const deleteListMutation = api.shopping.delete.useMutation({
    onSuccess: () => {
      window.location.href = "/shopping";
    },
  });

  function resetForm(): void {
    setIsAdding(false);
    setCreating(false);
    setProduct(null);
    setProductError(null);
    setNewItem({ quantity: 1, unit: "" });
  }

  /** Puts a chosen or freshly created product on the list. */
  function addProduct(chosen: PickedProduct): void {
    // Enqueued like the tick-off and the removal: all the writes on this
    // screen go the same way, so there is one path to get wrong. It also
    // means adding something works with no signal, and shows immediately
    // through the projection rather than after a round trip.
    const label = { key: "offline.addedItem", values: { name: chosen.name } };
    const queued = enqueue({
      path: "shopping.addItem",
      input: {
        shoppingListId: id,
        productId: chosen.id,
        quantity: newItem.quantity,
        unit: newItem.unit || chosen.defaultUnit,
      },
      label,
      holdMs: UNDO_HOLD_MS,
    });
    resetForm();

    // Refused for want of room: the queue is full and says so in the shell's
    // own banner, which is a state rather than an event. Claiming the item
    // was added would be a lie.
    if (!queued.ok) return;

    snackbar.show({ kind: "undo-queued", message: label, opId: queued.id });
  }

  const createProduct = api.product.create.useMutation({
    onSuccess: (created) => addProduct(created),
  });

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) {
      setProductError(t("shopping.productRequired"));
      return;
    }
    addProduct(product);
  };

  // Data first. `isLoading` is `isPending && isFetching`, which is *false*
  // for a paused query — so with no signal this fell straight through to
  // "not found" and told someone standing in a shop that the list they were
  // shopping from does not exist (ISSUES.md UI-9).
  if (!list) {
    if (isNotFoundError(listQuery.error)) {
      return <div className="p-8">{t("errors.notFound")}</div>;
    }
    return (
      <RouteState
        error={listQuery.error}
        fetchStatus={listQuery.fetchStatus}
        isLoading={listQuery.isPending}
        onRetry={() => void listQuery.refetch()}
        title={t("shopping.title")}
      />
    );
  }

  // The server's rows with the unsent changes folded on top. Without this, a
  // tab discarded mid-shop reopens showing the ticks undone, and every one of
  // them gets tapped again — with a *new* key each time, which is a double
  // count no idempotency can catch.
  const items = projectShoppingItems(list.items, queueState.pending, id);

  const totalItems = items.length;
  const checkedItems = items.filter((item) => item.isChecked).length;
  const progress = totalItems > 0 ? (checkedItems / totalItems) * 100 : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <BackLink href="/shopping">{t("common.back")}</BackLink>
          <div>
            <h1 className="text-2xl font-bold text-heading">{list.name}</h1>
            {list.isAutoGenerated && (
              <p className="text-sm text-muted-foreground">{t("shopping.autoDescription")}</p>
            )}
          </div>
        </div>
        <Button
          disabled={deleteListMutation.isPending}
          onClick={() => setConfirmingDelete(true)}
          ref={deleteRef}
          type="button"
          variant="destructive-ghost"
        >
          {t("shopping.delete")}
        </Button>
      </div>

      {/* Destructive, irreversible, and with no inverse to offer afterwards —
          the one shape a snackbar cannot serve. Deleting a list cascades its
          items and no procedure puts them back, so the honest moment to ask
          is before rather than after. */}
      <ConfirmDialog
        confirmLabel={t("shopping.deleteConfirm")}
        description={t("shopping.deleteConfirmBody")}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          deleteListMutation.mutate({ id });
        }}
        open={confirmingDelete}
        pending={deleteListMutation.isPending}
        returnFocus={deleteRef}
        title={t("shopping.deleteConfirmTitle", { name: list.name })}
      />

      {totalItems > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex justify-between text-sm">
            <span>{t("shopping.progress")}</span>
            <span>
              {checkedItems}/{totalItems} {t("common.items")}
            </span>
          </div>
          <div className="h-2 rounded-full bg-gauge-track">
            <div
              className="h-2 rounded-full bg-gauge transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-heading">{t("shopping.items")}</h2>
        {!isAdding && (
          <Button onClick={() => setIsAdding(true)} type="button">
            {t("shopping.addItem")}
          </Button>
        )}
      </div>

      {/* Two panels, never one nested inside the other.
          `CreateProductInline` is itself a `<form>`, and it used to be
          rendered inside this screen's add-item `<form>`. Nesting forms is
          invalid HTML, and Chromium's behaviour was measured rather than
          assumed: both elements exist (React builds the DOM through
          `createElement`, so nothing is dropped), the button's form owner is
          correctly the inner one, and pressing "Crear producto" still
          produced a native submission with no `product.create` request at
          all — a page load that threw away the name just typed.
          So the two forms are siblings, chosen between rather than stacked. */}
      {isAdding && creating && (
        <div className="rounded-lg border border-border bg-card p-4">
          {/* The kindness free text used to provide, in a better place:
              writing something the household has never bought still takes
              one step, and leaves it with a thing it can price next time. */}
          <CreateProductInline
            defaultName=""
            onCancel={() => setCreating(false)}
            onCreate={(name) =>
              createProduct.mutate({
                name,
                defaultUnit: newItem.unit || "unit",
              })
            }
          />
        </div>
      )}

      {isAdding && !creating && (
        <form
          onSubmit={handleAddItem}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="space-y-3">
            <ProductPicker
              error={productError ?? undefined}
              hint={t("shopping.productSelectHint")}
              onChange={(chosen) => {
                setProduct(chosen);
                setProductError(null);
                if (chosen && !newItem.unit) {
                  setNewItem((current) => ({
                    ...current,
                    unit: chosen.defaultUnit,
                  }));
                }
              }}
              value={product?.id ?? ""}
            />
            <Button
              onClick={() => setCreating(true)}
              type="button"
              variant="ghost"
            >
              {t("shopping.createProductPrompt")}
            </Button>

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label
                  className="mb-1 block font-medium text-foreground text-sm"
                  htmlFor={quantityId}
                >
                  {t("shopping.quantityLabel")}
                </label>
                <Input
                  className="w-28"
                  id={quantityId}
                  inputMode="decimal"
                  min="0.1"
                  onChange={(e) =>
                    setNewItem({
                      ...newItem,
                      quantity: Number.parseFloat(e.target.value) || 1,
                    })
                  }
                  step="any"
                  type="number"
                  value={newItem.quantity}
                />
              </div>
              <div>
                <label
                  className="mb-1 block font-medium text-foreground text-sm"
                  htmlFor={unitId}
                >
                  {t("shopping.unitLabel")}
                </label>
                <Input
                  className="w-32"
                  id={unitId}
                  onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                  value={newItem.unit}
                />
              </div>
              <Button disabled={createProduct.isPending} type="submit">
                {t("common.add")}
              </Button>
              <Button onClick={resetForm} type="button" variant="outline">
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* A `<ul>`, because `ItemRow` renders an `<li>` and every other screen
          that adopted it already wraps its rows. This one wrapped them in a
          `<div>`, so each row was an orphaned list item: drawn with a bullet,
          and announced without the count that makes a list worth being one. */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          <p>{t("shopping.emptyList")}</p>
          <p className="mt-2 text-sm">{t("shopping.addItems")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <ShoppingItem
              canWrite={canWrite}
              item={item}
              key={item.id}
              stores={stores}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
