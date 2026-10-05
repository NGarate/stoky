"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { ItemRow } from "@/components/ui/item-row";
import { EXPIRING_SOON_DAYS } from "@/lib/inventory/batches";

import type { JSX } from "react";

/**
 * When it goes off, and what that means — the expiry counterpart of
 * `StockStatus`, and for the same reason.
 *
 * Four screens answered this four ways. The Panel said "En 2 días" in a
 * danger pill; the kitchen said "Quedan 2 días" on a warn card and "Quedan 4
 * días" as plain grey text; the inventory's expiry block said "Mañana" and
 * "Hace 3 días"; the product page wrote "Caducado" as a red span with no pill
 * at all. One batch could therefore be danger on one screen and warn on the
 * next, and "Caducó hace 1 días" was a sentence the Panel actually printed.
 * There is one answer now.
 *
 * **The tone follows `badge.tsx`'s meanings, not urgency on a sliding scale:**
 *
 * - past its date is **wrong** — `danger`;
 * - within `EXPIRING_SOON_DAYS` (today included) **needs attention** —
 *   `warn`, the same threshold that puts a batch in the kitchen's "Usar ya";
 * - anything later is information, not a state — `neutral`.
 *
 * `daysUntilExpiry` is whole calendar days from `daysUntilExpiry()` in
 * `src/lib/inventory/batches.ts`: 0 today, negative once it has passed. The
 * server sends it already measured; a screen with only a date measures it
 * with the same helper rather than with `Date.now()` arithmetic.
 */
export function expiryTone(daysUntilExpiry: number): "danger" | "warn" | "neutral" {
  if (daysUntilExpiry < 0) return "danger";
  if (daysUntilExpiry <= EXPIRING_SOON_DAYS) return "warn";
  return "neutral";
}

/**
 * The words, one ICU-plural vocabulary in both directions.
 *
 * `onTintedRow` is `StockStatus`'s rule: on a row or card already tinted with
 * this tone the pill is outlined, or it vanishes into its own background.
 */
export function ExpiryStatus({
  className,
  daysUntilExpiry,
  onTintedRow = false,
}: {
  className?: string;
  daysUntilExpiry: number;
  onTintedRow?: boolean;
}): JSX.Element {
  const words = useTranslations("inventory.expiryStatus");

  return (
    <Badge
      className={className}
      tone={expiryTone(daysUntilExpiry)}
      variant={onTintedRow ? "outline" : "solid"}
    >
      {daysUntilExpiry < 0
        ? words("past", { days: -daysUntilExpiry })
        : words("upcoming", { days: daysUntilExpiry })}
    </Badge>
  );
}

/**
 * One batch that has expired or is about to, on the shared row grammar.
 *
 * The Panel and the inventory's expiry block each carried an identical copy
 * of this; it lives beside the status it shows so that there is one.
 */
export function ExpiryRow({
  batch,
  daysUntilExpiry,
}: {
  batch: {
    product: { id: string; name: string };
    location: { name: string } | null;
    quantity: number | null;
    unit: string;
  };
  daysUntilExpiry: number;
}): JSX.Element {
  const t = useTranslations("inventory.expiring");

  return (
    <ItemRow
      density="compact"
      href={`/products/${batch.product.id}`}
      meta={[
        {
          label: t("quantityLabel"),
          value:
            batch.quantity === null
              ? t("quantityUnknown")
              : t("quantityValue", { quantity: batch.quantity, unit: batch.unit }),
        },
        {
          label: t("locationLabel"),
          value: batch.location?.name ?? t("noLocation"),
        },
      ]}
      status={<ExpiryStatus daysUntilExpiry={daysUntilExpiry} />}
      title={batch.product.name}
      variant="plain"
    />
  );
}
