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

  // All three write to the list rendered directly below them, and none of
  // them told the cache. A store created here did not appear until the route
  // was left and re-entered; a deleted one stayed on screen. The form closing
  // was the only sign anything had happened at all, which is how a write that
  // succeeded and a write that silently failed came to look identical.
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-heading">{t("stores.title")}</h1>
        {!isCreating && (
          <Button onClick={() => setIsCreating(true)} type="button">
            {t("stores.create")}
          </Button>
        )}
      </div>

      {isCreating && (
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

      <div className="rounded-lg border border-border bg-card shadow-sm">
        {stores?.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <p>{t("stores.noStores")}</p>
            <p className="mt-2 text-sm">{t("stores.addFirst")}</p>
          </div>
        ) : (
          <ul className="space-y-3 p-3">
            {stores?.map((store: Store) => (
              <ItemRow
                actions={
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
                            onError: () =>
                              snackbar.show({
                                kind: "confirm",
                                tone: "danger",
                                message: {
                                  key: "stores.deleteFailed",
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
