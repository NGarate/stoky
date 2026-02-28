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

  const { data: stores, isLoading } = api.store.list.useQuery({ limit: 100 });

  const createMutation = api.store.create.useMutation({
    onSuccess: () => {
      setIsCreating(false);
      setFormData({ name: "", address: "" });
    },
  });

  const updateMutation = api.store.update.useMutation({
    onSuccess: () => {
      setEditingStore(null);
      setFormData({ name: "", address: "" });
    },
  });

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
        <h1 className="text-2xl font-bold">{t("stores.title")}</h1>
        {!isCreating && (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            {t("stores.create")}
          </button>
        )}
      </div>

      {isCreating && (
        <form onSubmit={handleSubmit} className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {t("common.save")}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md border border-gray-300 px-4 py-2 hover:bg-gray-50"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-lg border bg-white shadow-sm">
        {stores?.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>{t("stores.noStores")}</p>
            <p className="mt-2 text-sm">{t("stores.addFirst")}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {stores?.map((store: Store) => (
              <li key={store.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{store.name}</p>
                  {store.address && (
                    <p className="text-sm text-gray-500">{store.address}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(store)}
                    className="rounded-md px-3 py-1 text-sm text-blue-600 hover:bg-blue-50"
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate({ id: store.id })}
                    disabled={deleteMutation.isPending}
                    className="rounded-md px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
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
