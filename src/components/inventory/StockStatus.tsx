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

/**
 * What colour a row carrying this stock should be.
 *
 * The same three questions in the same order as `StockStatus` below, because
 * the row and the badge on it were deciding separately and disagreeing. The
 * inventory tinted by `isLowStock` alone, so a product at 0 of a minimum of 2
 * had a **warn** row under a **danger** badge, and a product at 0 with no
 * minimum at all had an untinted row under a danger badge — the one state
 * where the tint mattered most was the one it did not draw.
 *
 * That is UI-11 again in a different costume: two rules for one state, in one
 * file this time rather than two.
 */
export function stockTone(
  totalStock: number,
  isLowStock: boolean,
): "neutral" | "warn" | "danger" {
  if (totalStock <= 0) return "danger";
  if (isLowStock) return "warn";
  return "neutral";
}

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
 * **Filled or outlined follows the row, not the state.** The rule in
 * `badge.tsx`: an outline is for a badge sitting on a row already tinted with
 * its own tone. This used to be hard-coded per state — "Sin stock" always
 * filled, "Stock bajo" always outlined — which got both wrong somewhere: the
 * filled danger pill vanished into the inventory's `bg-danger` row, and the
 * outlined warn pill was the faint one on the Panel and /products, which do
 * not tint. `onTintedRow` says the row wears `stockTone`'s colour; the caller
 * knows, because the caller tinted it.
 */
export function StockStatus({
  className,
  isLowStock,
  onTintedRow = false,
  totalStock,
}: {
  /** Type size only — the kitchen reads it from a metre away. */
  className?: string;
  isLowStock: boolean;
  /** The row this sits on is tinted with `stockTone(totalStock, isLowStock)`. */
  onTintedRow?: boolean;
  totalStock: number;
}): JSX.Element {
  const t = useTranslations("inventory");
  // A healthy row is never tinted, so `ok` has nothing to clash with.
  const variant = onTintedRow ? "outline" : "solid";

  if (totalStock <= 0) {
    return (
      <Badge className={className} tone="danger" variant={variant}>
        {t("noStock")}
      </Badge>
    );
  }

  if (isLowStock) {
    return (
      <Badge className={className} tone="warn" variant={variant}>
        {t("lowStock")}
      </Badge>
    );
  }

  return (
    <Badge className={className} tone="ok">
      {t("stockOk")}
    </Badge>
  );
}
