"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

import type { JSX } from "react";

/**
 * How much is left, and what that means — the two atoms every list that shows
 * stock needs.
 *
 * They were local to `/inventory` and re-derived, differently, on three other
 * screens: `/products` computed its own tone from `minStock` while the
 * inventory asked the server for `isLowStock`, and the Panel wrote its pills
 * inline in the opposite precedence. One product could therefore wear two
 * different words on two screens (ISSUES UI-11). They live here now so that
 * there is one answer to give.
 */

/** The quantity, tinted by how worrying it is and always carrying its unit. */
export function StockAmount({
  defaultUnit,
  isLowStock,
  totalStock,
}: {
  defaultUnit: string;
  isLowStock: boolean;
  totalStock: number;
}): JSX.Element {
  return (
    <span
      className={`font-medium ${
        totalStock <= 0
          ? "text-danger-foreground"
          : isLowStock
            ? "text-warn-foreground"
            : "text-ok-foreground"
      }`}
    >
      {totalStock} {defaultUnit}
    </span>
  );
}

/**
 * The status, in words.
 *
 * **Run out is asked first, and that ordering is the whole point** (ISSUES
 * UI-11). A product at zero with a minimum set is both out and below its
 * minimum, so whichever question is asked first wins — and the two screens
 * asked in opposite orders. Café molido natural, at 0 of a minimum of 2, wore
 * "Stock bajo" on /inventory while the Panel called it "Sin stock". Two
 * screens, one product, two words for one state. Run out is the stronger
 * statement, so it wins; there is now one place that decides.
 *
 * The low-stock badge is outlined rather than filled: its row is already
 * tinted `bg-warn`, so a filled warn pill would vanish into it.
 */
export function StockStatus({
  isLowStock,
  totalStock,
}: {
  isLowStock: boolean;
  totalStock: number;
}): JSX.Element {
  const t = useTranslations("inventory");

  if (totalStock <= 0) {
    return <Badge tone="danger">{t("noStock")}</Badge>;
  }

  if (isLowStock) {
    return (
      <Badge tone="warn" variant="outline">
        {t("lowStock")}
      </Badge>
    );
  }

  return <Badge tone="ok">{t("stockOk")}</Badge>;
}
