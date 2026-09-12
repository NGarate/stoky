"use client";

import { Badge } from "@/components/ui/badge";
import { ItemRow } from "@/components/ui/item-row";
import { api } from "@/lib/trpc/client";
import { useTranslations } from "next-intl";
import type { JSX, ReactNode } from "react";

interface ExpiringItemsProps {
  days?: number;
  showExpired?: boolean;
  maxItems?: number;
}

/**
 * What is about to spoil, or already has — on the shared list grammar.
 *
 * The same `ItemRow` + `Badge` the dashboard's expiry section uses (its
 * `ExpiryRow`), rather than the hand-rolled tinted `<li>`s this once carried:
 * the state is a word in a `Badge`, not a colour and not an SVG, and the 48px
 * target floor comes from the `ItemRow` primitive instead of being restated on
 * the row (DEFERRED.md item 20). No page of its own — expiry is shown where it is
 * relevant (the inventory list, the Panel, the kitchen), and this is the block
 * the inventory list shows.
 */
export function ExpiringItems({
  days = 7,
  showExpired = true,
  maxItems = 10,
}: ExpiringItemsProps): JSX.Element {
  const t = useTranslations("inventory.expiring");

  const { data: expiringItems, isLoading: loadingExpiring } =
    api.inventory.getExpiringItems.useQuery({ days });

  const { data: expiredItems, isLoading: loadingExpired } =
    api.inventory.getExpiredItems.useQuery(
      {},
      { enabled: showExpired },
    );

  if (loadingExpiring || (showExpired && loadingExpired)) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {["skeleton-1", "skeleton-2", "skeleton-3"].map((key) => (
          <div key={key} className="h-16 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  const displayExpired = expiredItems?.slice(0, maxItems) ?? [];
  const displayExpiring = expiringItems?.slice(0, maxItems) ?? [];
  const hasExpired = displayExpired.length > 0;
  const hasExpiring = displayExpiring.length > 0;

  if (!hasExpired && !hasExpiring) {
    // Not an alert: nothing needs attention, so it is a plain line, the way the
    // Panel says the same thing. Reason first, no icon carrying a state.
    return <p className="text-muted-foreground">{t("allClear")}</p>;
  }

  return (
    <div className="space-y-6">
      {hasExpired ? (
        <section aria-labelledby="expiring-expired">
          <h2
            id="expiring-expired"
            className="text-lg font-semibold text-heading"
          >
            {t("expiredHeading", { count: expiredItems?.length ?? 0 })}
          </h2>
          <ul className="mt-3 divide-y divide-border">
            {displayExpired.map((item) => (
              <ExpiryRow
                key={item.id}
                item={item}
                locationLabel={t("locationLabel")}
                noLocationLabel={t("noLocation")}
                quantityLabel={t("quantityLabel")}
                quantityValue={t("quantityValue", {
                  quantity: item.quantity ?? t("quantityUnknown"),
                  unit: item.unit,
                })}
                status={
                  <Badge tone="danger">
                    {t("daysAgo", { days: item.daysExpired })}
                  </Badge>
                }
              />
            ))}
          </ul>
          {expiredItems && expiredItems.length > maxItems ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("more", { count: expiredItems.length - maxItems })}
            </p>
          ) : null}
        </section>
      ) : null}

      {hasExpiring ? (
        <section aria-labelledby="expiring-soon">
          <h2
            id="expiring-soon"
            className="text-lg font-semibold text-heading"
          >
            {t("expiringHeading", { days, count: expiringItems?.length ?? 0 })}
          </h2>
          <ul className="mt-3 divide-y divide-border">
            {displayExpiring.map((item) => (
              <ExpiryRow
                key={item.id}
                item={item}
                locationLabel={t("locationLabel")}
                noLocationLabel={t("noLocation")}
                quantityLabel={t("quantityLabel")}
                quantityValue={t("quantityValue", {
                  quantity: item.quantity ?? t("quantityUnknown"),
                  unit: item.unit,
                })}
                status={
                  <Badge tone={item.isExpiringSoon ? "danger" : "warn"}>
                    {t("until", { days: item.daysUntilExpiry })}
                  </Badge>
                }
              />
            ))}
          </ul>
          {expiringItems && expiringItems.length > maxItems ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("more", { count: expiringItems.length - maxItems })}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** One expiry row, the same shape the Panel draws (ItemRow, compact, plain). */
function ExpiryRow({
  item,
  locationLabel,
  noLocationLabel,
  quantityLabel,
  quantityValue,
  status,
}: {
  item: {
    product: { id: string; name: string };
    location: { name: string } | null;
  };
  locationLabel: string;
  noLocationLabel: string;
  quantityLabel: string;
  quantityValue: string;
  status: ReactNode;
}): JSX.Element {
  return (
    <ItemRow
      density="compact"
      href={`/products/${item.product.id}`}
      meta={[
        { label: quantityLabel, value: quantityValue },
        {
          label: locationLabel,
          value: item.location?.name ?? noLocationLabel,
        },
      ]}
      status={status}
      title={item.product.name}
      variant="plain"
    />
  );
}
