"use client";

import { useTranslations } from "next-intl";
import { api } from "@/lib/trpc/client";

interface StoreSelectorProps {
  value?: string;
  onChange: (storeId: string) => void;
  placeholder?: string;
  className?: string;
  /** Lets a <label htmlFor> name the control — required anywhere it renders. */
  id?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
}

export function StoreSelector({
  value,
  onChange,
  placeholder,
  className,
  id,
  ariaDescribedBy,
  ariaInvalid,
}: StoreSelectorProps) {
  const t = useTranslations("stores");
  const { data: stores, isLoading } = api.store.list.useQuery({ limit: 100 });

  if (isLoading) {
    return (
      <select disabled id={id} className={`rounded-md border border-input bg-card px-3 py-2 text-foreground ${className}`}>
        <option>{t("select")}...</option>
      </select>
    );
  }

  return (
    <select
      id={id}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      className={`rounded-md border border-input bg-card px-3 py-2 text-foreground ${className}`}
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
