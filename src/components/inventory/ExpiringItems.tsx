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
      <div className="p-4 bg-white rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">
          Productos próximos a caducar
        </h3>
        <div className="space-y-2">
          {['loading-skeleton-1', 'loading-skeleton-2', 'loading-skeleton-3'].map((key) => (
            <div key={key} className="h-12 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const hasExpired = expiredItems && expiredItems.length > 0;
  const hasExpiring = expiringItems && expiringItems.length > 0;

  if (!hasExpired && !hasExpiring) {
    return (
      <div className="p-4 bg-green-50 rounded-lg border border-green-200">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-green-600"
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
          <p className="text-green-800">
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
        <div className="p-4 bg-red-50 rounded-lg border border-red-200">
          <div className="flex items-center gap-2 mb-3">
            <svg
              className="w-5 h-5 text-red-600"
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
            <h3 className="font-semibold text-red-800">
              Productos caducados ({expiredItems?.length})
            </h3>
          </div>
          <ul className="space-y-2">
            {displayExpired.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between p-2 bg-white rounded"
              >
                <div className="flex items-center gap-3">
                  <Link
                    href={`/products/${item.product.id}`}
                    className="font-medium text-red-700 hover:underline"
                  >
                    {item.product.name}
                  </Link>
                  {item.location && (
                    <span className="text-sm text-gray-500">
                      en {item.location.name}
                    </span>
                  )}
                </div>
                <span className="text-sm font-medium text-red-600">
                  Hace {item.daysExpired} días
                </span>
              </li>
            ))}
          </ul>
          {expiredItems && expiredItems.length > maxItems && (
            <p className="mt-2 text-sm text-red-600">
              Y {expiredItems.length - maxItems} más...
            </p>
          )}
        </div>
      )}

      {/* Expiring Soon Items */}
      {hasExpiring && (
        <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
          <div className="flex items-center gap-2 mb-3">
            <svg
              className="w-5 h-5 text-yellow-600"
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
            <h3 className="font-semibold text-yellow-800">
              Caducan en los próximos {days} días ({expiringItems?.length})
            </h3>
          </div>
          <ul className="space-y-2">
            {displayExpiring.map((item) => (
              <li
                key={item.id}
                className={`flex items-center justify-between p-2 rounded ${
                  item.isExpiringSoon ? "bg-red-100" : "bg-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Link
                    href={`/products/${item.product.id}`}
                    className={`font-medium hover:underline ${
                      item.isExpiringSoon
                        ? "text-red-700"
                        : "text-yellow-700"
                    }`}
                  >
                    {item.product.name}
                  </Link>
                  {item.location && (
                    <span className="text-sm text-gray-500">
                      en {item.location.name}
                    </span>
                  )}
                </div>
                <span
                  className={`text-sm font-medium ${
                    item.isExpiringSoon
                      ? "text-red-600"
                      : "text-yellow-600"
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
            <p className="mt-2 text-sm text-yellow-600">
              Y {expiringItems.length - maxItems} más...
            </p>
          )}
        </div>
      )}
    </div>
  );
}
