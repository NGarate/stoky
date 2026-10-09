"use client";

import React, { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { sectionHeading } from "@/components/ui/section";
import { ProductPicker, type PickedProduct } from "@/components/inventory/ProductPicker";
import { CreateProductInline } from "@/components/receipt/CreateProductInline";
import { api } from "@/lib/trpc/client";
import { ShoppingItem } from "@/components/shopping/ShoppingItem";
import { RouteState } from "@/components/household/RouteState";
import { useWriteQueue } from "@/lib/offline/queue-context";
import { undoHoldMs } from "@/lib/snackbar-duration";
import { useSnackbar } from "@/components/ui/snackbar";
import { projectShoppingItems } from "@/lib/offline/project";

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

  const router = useRouter();
  const utils = api.useUtils();
  /**
   * Leave, and say so on the way out — the shape the product page's delete
   * has. This was `window.location.href = "/shopping"`: a full reload that
   * dropped the client cache and the snackbar with it, so nothing said the
   * list was gone, and it landed on the shop screen rather than on the lists
   * the person came from. `replace`, because the deleted list is no longer
   * a place Back should return to.
   */
  const deleteListMutation = api.shopping.delete.useMutation({
    onSuccess: () => {
      snackbar.show({
        kind: "confirm",
        message: { key: "shopping.listDeleted", values: { name: list?.name ?? "" } },
      });
      router.replace("/shopping/lists");
      // Taken out of the persisted copies first. Being marked stale below
      // corrects a screen only when it mounts with signal; signal lost
      // between here and /shopping left the restored buy list showing the
      // deleted items, and ticking one queued a write against a row that was
      // gone. Not refetched instead: a read restored from storage has no
      // query function until a screen mounts it, so refetching it now would
      // turn it into an error.
      utils.shopping.getBuyList.setData(undefined, (items) =>
        items?.filter((item) => item.listId !== id),
      );
      utils.shopping.list.setQueriesData({}, {}, (lists) =>
        lists?.filter((each) => each.id !== id),
      );
      // Every shopping read, not only the lists: the buy list and this
      // list's own read are persisted too, and both still held the deleted
      // list and its items — on /shopping for the freshness window, and
      // offline for as long as there was no signal. Marked stale without
      // refetching now, so this page does not re-ask for the list it just
      // deleted on its way out; each screen refetches when it mounts.
      void utils.shopping.invalidate(undefined, { refetchType: "none" });
    },
    onError: () =>
      snackbar.show({
        kind: "confirm",
        tone: "danger",
        message: { key: "shopping.deleteFailed" },
      }),
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
      holdMs: undoHoldMs(),
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
  //
  // A list that really is gone — most often deleted by someone else in the
  // household, under the person holding it — gets a page that says so, why,
  // and the way back. It was a bare "No encontrado" with no heading and no
  // link: a dead end reached from a link that used to work.
  if (!list) {
    return (
      <RouteState
        back={{ href: "/shopping/lists", label: t("shopping.backToLists") }}
        error={listQuery.error}
        fetchStatus={listQuery.fetchStatus}
        isLoading={listQuery.isPending}
        notFound={{
          title: t("shopping.notFoundTitle"),
          body: t("shopping.notFoundBody"),
        }}
        onRetry={() => void listQuery.refetch()}
        title={t("shopping.title")}
        width="detail"
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
    <PageShell width="detail">
      <PageHeader
        actions={
          /* Destructive, so it looks it: as a plain ghost it wore the same
             dress as "Editar". The trigger is destructive-ghost and the
             confirming button solid destructive (the one destructive-control
             rule). Only for the roles `writeProcedure` admits — a KITCHEN
             account was offered a delete the server refuses. */
          canWrite ? (
            <Button
              disabled={deleteListMutation.isPending}
              onClick={() => setConfirmingDelete(true)}
              ref={deleteRef}
              type="button"
              variant="destructive-ghost"
            >
              {t("shopping.delete")}
            </Button>
          ) : undefined
        }
        back={{ href: "/shopping/lists", label: t("shopping.backToLists") }}
        intro={list.isAutoGenerated ? t("shopping.autoDescription") : undefined}
        title={list.name}
      />
      <div className="space-y-6">

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
            {/* A sentence, not "2/5 elementos": what the bar counts is what
                has been bought. */}
            <span>
              {t("shopping.progressValue", {
                checked: checkedItems,
                total: totalItems,
              })}
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
        <h2 className={sectionHeading()}>{t("shopping.items")}</h2>
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
              {/* "Añadir a la lista", not a bare "Añadir": the button that
                  opened this form says "Añadir un producto", and the one
                  that commits it says where the product goes. */}
              <Button disabled={createProduct.isPending} type="submit">
                {t("shopping.addToList")}
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
        // No button of its own: "Añadir artículo" sits directly above, and a
        // second one a line below it would be the same control twice.
        <EmptyState body={t("shopping.addItems")} title={t("shopping.emptyList")} />
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
    </PageShell>
  );
}
