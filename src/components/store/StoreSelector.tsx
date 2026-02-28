"use client";

import { useTranslations } from "next-intl";
import { api } from "@/lib/trpc/client";

interface StoreSelectorProps {
  value?: string;
  onChange: (storeId: string) => void;
  placeholder?: string;
  className?: string;
}

export function StoreSelector({
  value,
  onChange,
  placeholder,
  className,
}: StoreSelectorProps) {
  const t = useTranslations("stores");
  const { data: stores, isLoading } = api.store.list.useQuery({ limit: 100 });

  if (isLoading) {
    return (
      <select disabled className={`rounded-md border border-gray-300 px-3 py-2 ${className}`}>
        <option>{t("select")}...</option>
      </select>
    );
  }

  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none ${className}`}
    >
      <option value="">{placeholder || t("select")}</option>
      {stores?.map((store: { id: string; name: string }) => (
        <option key={store.id} value={store.id}>
          {store.name}
        </option>
      ))}
    </select>
  );
}
