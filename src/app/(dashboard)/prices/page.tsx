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

      <div className="relative">
        <input
          type="text"
          placeholder={t("products.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-input bg-card px-4 py-2 pl-10 text-foreground"
        />
        <svg
          className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <title>{t("common.search")}</title>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
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
                    <svg
                      className="h-5 w-5 text-muted-foreground"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-label="Ver detalles"
                    >
                      <title>Ver detalles</title>
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
