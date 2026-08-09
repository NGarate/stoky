"use client";

import { api } from "@/lib/trpc/client";
import Link from "next/link";

interface ExpiringItemsProps {
  days?: number;
  showExpired?: boolean;
  maxItems?: number;
}

export function ExpiringItems({
  days = 7,
  showExpired = true,
  maxItems = 10,
}: ExpiringItemsProps) {
  const { data: expiringItems, isLoading: loadingExpiring } =
    api.inventory.getExpiringItems.useQuery({ days });

  const { data: expiredItems, isLoading: loadingExpired } =
    api.inventory.getExpiredItems.useQuery({}, {
      enabled: showExpired,
    });

  if (loadingExpiring || (showExpired && loadingExpired)) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow">
        <h2 className="text-lg font-semibold mb-4 text-heading">
          Productos próximos a caducar
        </h2>
        <div className="space-y-2">
          {['loading-skeleton-1', 'loading-skeleton-2', 'loading-skeleton-3'].map((key) => (
            <div key={key} className="h-12 bg-muted rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const hasExpired = expiredItems && expiredItems.length > 0;
  const hasExpiring = expiringItems && expiringItems.length > 0;

  if (!hasExpired && !hasExpiring) {
    return (
      <div className="rounded-lg border border-ok-foreground bg-ok p-4">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-ok-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <title>Todo correcto</title>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-ok-foreground">
            No hay productos caducados ni próximos a caducar
          </p>
        </div>
      </div>
    );
  }

  const displayExpired = expiredItems?.slice(0, maxItems) || [];
  const displayExpiring = expiringItems?.slice(0, maxItems) || [];

  return (
    <div className="space-y-4">
      {/* Expired Items Alert */}
      {hasExpired && (
        <div className="rounded-lg border border-danger-foreground bg-danger p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg
              className="w-5 h-5 text-danger-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <title>Alerta</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <h2 className="font-semibold text-danger-foreground">
              Productos caducados ({expiredItems?.length})
            </h2>
          </div>
          <ul className="space-y-2">
            {displayExpired.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between p-2 bg-card rounded"
              >
                <div className="flex items-center gap-3">
                  <Link
                    href={`/products/${item.product.id}`}
                    className="inline-flex min-h-[48px] items-center font-medium text-danger-foreground hover:underline"
                  >
                    {item.product.name}
                  </Link>
                  {item.location && (
                    <span className="text-sm text-muted-foreground">
                      en {item.location.name}
                    </span>
                  )}
                </div>
                <span className="text-sm font-medium text-danger-foreground">
                  Hace {item.daysExpired} días
                </span>
              </li>
            ))}
          </ul>
          {expiredItems && expiredItems.length > maxItems && (
            <p className="mt-2 text-sm text-danger-foreground">
              Y {expiredItems.length - maxItems} más...
            </p>
          )}
        </div>
      )}

      {/* Expiring Soon Items */}
      {hasExpiring && (
        <div className="rounded-lg border border-warn-foreground bg-warn p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg
              className="w-5 h-5 text-warn-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <title>Advertencia</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h2 className="font-semibold text-warn-foreground">
              Caducan en los próximos {days} días ({expiringItems?.length})
            </h2>
          </div>
          <ul className="space-y-2">
            {displayExpiring.map((item) => (
              <li
                key={item.id}
                className={`flex items-center justify-between p-2 rounded ${
                  item.isExpiringSoon ? "bg-danger" : "bg-card"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Link
                    href={`/products/${item.product.id}`}
                    className={`inline-flex min-h-[48px] items-center font-medium hover:underline ${
                      item.isExpiringSoon
                        ? "text-danger-foreground"
                        : "text-warn-foreground"
                    }`}
                  >
                    {item.product.name}
                  </Link>
                  {item.location && (
                    <span className="text-sm text-muted-foreground">
                      en {item.location.name}
                    </span>
                  )}
                </div>
                <span
                  className={`text-sm font-medium ${
                    item.isExpiringSoon
                      ? "text-danger-foreground"
                      : "text-warn-foreground"
                  }`}
                >
                  {item.daysUntilExpiry === 0
                    ? "Hoy"
                    : item.daysUntilExpiry === 1
                      ? "Mañana"
                      : `En ${item.daysUntilExpiry} días`}
                </span>
              </li>
            ))}
          </ul>
          {expiringItems && expiringItems.length > maxItems && (
            <p className="mt-2 text-sm text-warn-foreground">
              Y {expiringItems.length - maxItems} más...
            </p>
          )}
        </div>
      )}
    </div>
  );
}
