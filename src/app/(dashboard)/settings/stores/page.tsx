"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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

  const utils = api.useUtils();
  const { data: stores, isLoading } = api.store.list.useQuery({ limit: 100 });

  // All three write to the list rendered directly below them, and none of
  // them told the cache. A store created here did not appear until the route
  // was left and re-entered; a deleted one stayed on screen. The form closing
  // was the only sign anything had happened at all, which is how a write that
  // succeeded and a write that silently failed came to look identical.
  const createMutation = api.store.create.useMutation({
    onSuccess: async () => {
      setIsCreating(false);
      setFormData({ name: "", address: "" });
      await utils.store.list.invalidate();
    },
  });

  const updateMutation = api.store.update.useMutation({
    onSuccess: async () => {
      setEditingStore(null);
      setFormData({ name: "", address: "" });
      await utils.store.list.invalidate();
    },
  });

  const deleteMutation = api.store.delete.useMutation({
    onSuccess: async () => {
      await utils.store.list.invalidate();
    },
  });

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
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="min-h-[48px] rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            {t("stores.create")}
          </button>
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
              <input
                id="store-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-foreground"
                required
              />
            </div>
            <div>
              <label htmlFor="store-address" className="mb-1 block text-sm font-medium">{t("stores.address")}</label>
              <input
                id="store-address"
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-foreground"
              />
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="min-h-[48px] rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {t("common.save")}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md border border-input bg-card px-4 py-2 text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {t("common.cancel")}
            </button>
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
          <ul className="divide-y divide-border">
            {stores?.map((store: Store) => (
              <li key={store.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{store.name}</p>
                  {store.address && (
                    <p className="text-sm text-muted-foreground">{store.address}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(store)}
                    className="min-h-[48px] rounded-md px-3 py-1 text-sm text-primary hover:bg-accent"
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate({ id: store.id })}
                    disabled={deleteMutation.isPending}
                    className="min-h-[48px] rounded-md px-3 py-1 text-sm text-destructive hover:bg-danger disabled:opacity-50"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
