"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSnackbar } from "@/components/ui/snackbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemRow } from "@/components/ui/item-row";
import { api } from "@/lib/trpc/client";
import type { StoreInput } from "@/lib/validations/store";

interface Store {
  id: string;
  name: string;
  address: string | null;
  householdId: string;
}

export default function StoresPage() {
  const t = useTranslations();
  const [isCreating, setIsCreating] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [formData, setFormData] = useState<StoreInput>({
    name: "",
    address: "",
  });

  const snackbar = useSnackbar();
  const utils = api.useUtils();
  const { data: stores, isLoading } = api.store.list.useQuery({ limit: 100 });

  // All three writes here are `adminProcedure`, and this screen drew "Crear
  // tienda", "Editar" and "Eliminar" for everyone — so a MEMBER was offered
  // three things the server refuses, and found out by pressing one. Courtesy
  // only, like the shopping row's `canWrite`: the server is the control.
  const me = api.auth.me.useQuery(undefined, { retry: false });
  const canManage = me.data?.role === "OWNER" || me.data?.role === "ADMIN";

  // All three write to the list rendered directly below them, and none of
  // them told the cache. A store created here did not appear until the route
  // was left and re-entered; a deleted one stayed on screen. The form closing
  // was the only sign anything had happened at all, which is how a write that
  // succeeded and a write that silently failed came to look identical.
  function reportSaveFailure(): void {
    snackbar.show({
      kind: "confirm",
      tone: "danger",
      message: { key: "stores.saveFailed" },
    });
  }

  const createMutation = api.store.create.useMutation({
    onSuccess: async (store) => {
      setIsCreating(false);
      setFormData({ name: "", address: "" });
      await utils.store.list.invalidate();
      snackbar.show({
        kind: "confirm",
        message: { key: "stores.created", values: { name: store.name } },
      });
    },
    // A failure left the form open with the data still in it and said
    // nothing, so a refused write looked like a form somebody had not
    // finished filling in.
    onError: () => reportSaveFailure(),
  });

  const updateMutation = api.store.update.useMutation({
    onSuccess: async (store) => {
      setEditingStore(null);
      setFormData({ name: "", address: "" });
      await utils.store.list.invalidate();
      snackbar.show({
        kind: "confirm",
        message: { key: "stores.updated", values: { name: store.name } },
      });
    },
    onError: () => reportSaveFailure(),
  });

  // No `onSuccess` here: the deleted store's name is in neither the input nor
  // the result, so the per-call form is the only place that still knows it.
  const deleteMutation = api.store.delete.useMutation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingStore) {
      updateMutation.mutate({ id: editingStore.id, ...formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (store: Store) => {
    setEditingStore(store);
    setFormData({
      name: store.name,
      address: store.address || "",
    });
    setIsCreating(true);
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingStore(null);
    setFormData({ name: "", address: "" });
  };

  if (isLoading) {
    return <div className="p-8">{t("common.loading")}</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-heading">{t("stores.title")}</h1>
        {canManage && !isCreating && (
          <Button onClick={() => setIsCreating(true)} type="button">
            {t("stores.create")}
          </Button>
        )}
      </div>

      {/* Said once, plainly, rather than left to be discovered by pressing
          something. A reader who cannot change the shops can still read
          them — which is the whole of what this screen is for them. */}
      {!canManage && me.data ? (
        <p className="rounded border border-border bg-card p-4 text-muted-foreground">
          {t("stores.readOnly")}
        </p>
      ) : null}

      {canManage && isCreating && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-heading">
            {editingStore ? t("stores.edit") : t("stores.create")}
          </h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="store-name" className="mb-1 block text-sm font-medium">{t("stores.name")} *</label>
              <Input
                id="store-name"
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                type="text"
                value={formData.name}
              />
            </div>
            <div>
              <label htmlFor="store-address" className="mb-1 block text-sm font-medium">{t("stores.address")}</label>
              <Input
                id="store-address"
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                type="text"
                value={formData.address}
              />
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            <Button
              disabled={createMutation.isPending || updateMutation.isPending}
              type="submit"
            >
              {t("common.save")}
            </Button>
            {/* Was a bare button with no `min-h` at all — the one control on
                this screen that undoes a mistake, and the only one under the
                target floor. */}
            <Button onClick={handleCancel} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}

      {/* No card around the cards. `ItemRow` draws each row as one, so a
          bordered, shadowed box holding them put a card inside a card —
          two frames for one list, and the owner's rule is no card without a
          concrete reason (DESIGN_AUDIT A5.4). The inventory and the
          catalogue already list into a bare `<ul>`. */}
      <div>
        {stores?.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
            <p>{t("stores.noStores")}</p>
            <p className="mt-2 text-sm">{t("stores.addFirst")}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {stores?.map((store: Store) => (
              <ItemRow
                actions={
                  canManage ? (
                  <>
                    <Button
                      onClick={() => handleEdit(store)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {t("common.edit")}
                      <span className="sr-only"> {store.name}</span>
                    </Button>
                    <Button
                      disabled={deleteMutation.isPending}
                      onClick={() =>
                        deleteMutation.mutate(
                          { id: store.id },
                          {
                            onSuccess: async () => {
                              await utils.store.list.invalidate();
                              snackbar.show({
                                kind: "confirm",
                                message: {
                                  key: "stores.deleted",
                                  values: { name: store.name },
                                },
                              });
                            },
                            // The specific sentence only for the specific
                            // failure. "Todavía hay precios o tickets de esa
                            // tienda" is true of a CONFLICT and a guess about
                            // anything else — it was shown for every failure,
                            // so a refused permission or a dropped connection
                            // was explained as data that does not exist.
                            onError: (error) =>
                              snackbar.show({
                                kind: "confirm",
                                tone: "danger",
                                message: {
                                  key:
                                    error.data?.code === "CONFLICT"
                                      ? "stores.deleteFailed"
                                      : "stores.deleteFailedUnknown",
                                  values: { name: store.name },
                                },
                              }),
                          },
                        )
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <span className="text-destructive">{t("common.delete")}</span>
                      <span className="sr-only"> {store.name}</span>
                    </Button>
                  </>
                  ) : undefined
                }
                key={store.id}
                meta={
                  store.address
                    ? [{ label: t("stores.address"), value: store.address }]
                    : undefined
                }
                title={store.name}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
