"use client";

import { ExpiryRow } from "@/components/inventory/ExpiryStatus";
import { api } from "@/lib/trpc/client";
import { SectionState } from "@/components/household/RouteState";
import { useTranslations } from "next-intl";
import type { JSX } from "react";

interface ExpiringItemsProps {
  days?: number;
  showExpired?: boolean;
  maxItems?: number;
}

/**
 * What is about to spoil, or already has — on the shared list grammar.
 *
 * The same `ExpiryRow` the dashboard's expiry section uses, rather than the
 * hand-rolled tinted `<li>`s this once carried: the state is `ExpiryStatus`'s
 * word in a `Badge`, not a colour and not an SVG, and the 48px
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

  const expiring = api.inventory.getExpiringItems.useQuery({ days });
  const expired = api.inventory.getExpiredItems.useQuery(
    {},
    { enabled: showExpired },
  );
  const expiringItems = expiring.data;
  const expiredItems = expired.data;

  // On the data, not on `isLoading` — which is false for a query paused
  // offline or one that failed, so either fell through to "allClear": a
  // failure reading as the good news that nothing is about to spoil.
  const unanswered = !expiringItems
    ? expiring
    : showExpired && !expiredItems
      ? expired
      : null;
  if (unanswered !== null) {
    return (
      <SectionState
        error={unanswered.error}
        fetchStatus={unanswered.fetchStatus}
        onRetry={() => void unanswered.refetch()}
      />
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
                batch={item}
                daysUntilExpiry={-item.daysExpired}
                key={item.id}
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
                batch={item}
                daysUntilExpiry={item.daysUntilExpiry}
                key={item.id}
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
