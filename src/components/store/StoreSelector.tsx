"use client";

import { useTranslations } from "next-intl";

import { Select } from "@/components/ui/select";
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

/**
 * The household's shops, as the `Select` primitive.
 *
 * It was a raw `<select>` of its own: `bg-card` where every other field is
 * `bg-background`, no focus outline of its own, and no target floor, so both
 * callers restated the 48px floor — the loose end `target-floor.test.ts`
 * named. The primitive owns all three now.
 */
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
      <Select className={className} disabled id={id}>
        <option>{t("select")}...</option>
      </Select>
    );
  }

  return (
    <Select
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      className={className}
      id={id}
      onChange={(e) => onChange(e.target.value)}
      value={value || ""}
    >
      <option value="">{placeholder || t("select")}</option>
      {stores?.map((store: { id: string; name: string }) => (
        <option key={store.id} value={store.id}>
          {store.name}
        </option>
      ))}
    </Select>
  );
}
