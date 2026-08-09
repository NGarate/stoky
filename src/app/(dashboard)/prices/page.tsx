"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { BestPriceIndicator } from "@/components/price/BestPriceIndicator";

export default function PricesPage() {
  const t = useTranslations();
  const [search, setSearch] = useState("");

  const { data: products, isLoading } = api.price.getProductPrices.useQuery({
    search: search || undefined,
    limit: 50,
  });

  if (isLoading) {
    return <div className="p-8">{t("common.loading")}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-heading">{t("prices.title")}</h1>
      </div>

      {/* The placeholder was doing the job of the label, which means the field
          loses its name the moment someone types in it — and keeps it lost for
          anyone who comes back to a half-filled search. A real label stays. */}
      <div>
        <label
          className="mb-1 block text-sm font-medium text-foreground"
          htmlFor="price-search"
        >
          {t("common.search")}
        </label>
        {/* The icon is positioned against this wrapper rather than the whole
            block, so the label can sit above without the magnifier drifting
            up into it. */}
        <div className="relative">
          <input
            id="price-search"
            type="search"
            placeholder={t("products.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-[48px] w-full rounded-md border border-input bg-card px-4 py-2 pl-10 text-foreground"
          />
          <svg
            aria-hidden="true"
            className="-translate-y-1/2 absolute top-1/2 left-3 h-5 w-5 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-sm">
        {products?.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <p>{t("prices.noPrices")}</p>
            <p className="mt-2 text-sm">{t("prices.addFirst")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {products?.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/prices/${product.id}`}
                  className="flex items-center justify-between p-4 hover:bg-muted"
                >
                  <div className="flex-1">
                    <p className="font-medium">{product.name}</p>
                    {product.category && (
                      <p className="text-sm text-muted-foreground">{product.category}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    {product.priceRecords.length > 0 ? (
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">{t("products.lastPrice")}</p>
                        <p className="font-medium">
                          €{product.priceRecords[0].price.toFixed(2)}
                        </p>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {t("prices.noPrices")}
                      </span>
                    )}
                    <BestPriceIndicator productId={product.id} />
                    {/* The whole row is the link, so its name already reads
                        "Leche entera · Lácteos · Último precio €0.99 …". A
                        chevron announcing "Ver detalles" on the end of that
                        adds a hardcoded Spanish string to an otherwise
                        translated name, and says nothing the row has not
                        already said. */}
                    <svg
                      aria-hidden="true"
                      className="h-5 w-5 text-muted-foreground"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
