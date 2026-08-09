"use client";

import { useDeferredValue, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/trpc/client";

/**
 * The subset of a product this picker hands back to its parent. Kept narrow on
 * purpose: the caller only needs the identity and the unit to prefill.
 */
export interface PickedProduct {
  id: string;
  name: string;
  brand: string | null;
  defaultUnit: string;
}

interface ProductPickerProps {
  /** Currently selected product id, or "" for none. */
  value: string;
  /** Called with the whole product so the caller can prefill the unit. */
  onChange: (product: PickedProduct | null) => void;
  /** Already-translated error message. Rendered inline and linked via aria-describedby. */
  error?: string;
}

/**
 * Product selection for the stock screens.
 *
 * A free-text filter plus a native <select>. The select is used rather than a
 * custom combobox because it is keyboard- and screen-reader-correct for free,
 * and the filter above it keeps the option list short when a household has
 * hundreds of products.
 */
export function ProductPicker({ value, onChange, error }: ProductPickerProps) {
  const t = useTranslations("inventory.add");
  const [search, setSearch] = useState("");
  // Keeps typing responsive: the query re-runs against the settled value.
  const deferredSearch = useDeferredValue(search);

  const searchId = useId();
  const selectId = useId();
  const statusId = useId();
  const errorId = useId();

  const trimmedSearch = deferredSearch.trim();

  const { data, isPending } = api.product.list.useQuery(
    {
      limit: 50,
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
    },
    {
      // Hold the previous options on screen while the next page loads, so the
      // list does not blink empty on every keystroke.
      placeholderData: (previous) => previous,
    },
  );

  const products = data?.products ?? [];

  const statusMessage = isPending
    ? t("loadingProducts")
    : products.length === 0
      ? t("noProducts")
      : t("productSelectHint");

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor={searchId}
          className="mb-1 block text-sm font-medium text-foreground"
        >
          {t("productSearchLabel")}
        </label>
        <input
          id={searchId}
          name="product"
          type="search"
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("productSearchPlaceholder")}
          className="min-h-[48px] w-full rounded border border-input bg-card px-3 py-2 text-foreground"
        />
      </div>

      <div>
        <label
          htmlFor={selectId}
          className="mb-1 block text-sm font-medium text-foreground"
        >
          {t("productLabel")}
        </label>
        <select
          id={selectId}
          name="productId"
          required
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${statusId} ${errorId}` : statusId}
          onChange={(event) => {
            const selected = products.find(
              (product) => product.id === event.target.value,
            );
            onChange(
              selected
                ? {
                    id: selected.id,
                    name: selected.name,
                    brand: selected.brand,
                    defaultUnit: selected.defaultUnit,
                  }
                : null,
            );
          }}
          className="min-h-[48px] w-full rounded border border-input bg-card px-3 py-2 text-foreground"
        >
          <option value="">{t("productPlaceholder")}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.brand
                ? t("productOption", {
                    name: product.name,
                    brand: product.brand,
                  })
                : product.name}
            </option>
          ))}
        </select>
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          className="mt-1 text-sm text-muted-foreground"
        >
          {statusMessage}
        </p>
        {error ? (
          <p id={errorId} className="mt-1 text-sm font-medium text-danger-foreground">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
