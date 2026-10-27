import type { Decimal } from "@prisma/client-runtime-utils";

/**
 * Money, written the way the reader's language writes it.
 *
 * Sixteen call sites across the price screens wrote `€{n.toFixed(2)}` by
 * hand, which is not a formatting shortcut but a wrong answer: Spanish puts
 * the symbol after the number and separates decimals with a comma, so
 * `€1.19` is a price no Spanish reader writes. One screen — the product
 * detail — already did this correctly and kept the function to itself.
 *
 * The currency is a parameter with no default on purpose. `PriceRecord`
 * carries its own `currency` column, and the two places that genuinely do
 * not have one to hand should say `DEFAULT_CURRENCY` out loud rather than
 * inherit an assumption from a signature.
 */

/** `PriceRecord.currency`'s schema default, for callers whose data omits it. */
export const DEFAULT_CURRENCY = "EUR";

/**
 * `PriceRecord.currency` is a free-text column with a default, so a row
 * written by something other than this app could hold a code `Intl` rejects.
 * That throws a `RangeError`, which would take a whole page down over one bad
 * row — and the number is still worth showing.
 */
export function formatMoney(
  locale: string,
  amount: number | Decimal,
  currency: string,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * A unit price, which can be a fraction of a cent.
 *
 * 500 g at 1,20 € is 0,0024 € a gram, and `formatMoney`'s two decimals would
 * write that as "0,00 €" — a price of nothing. Up to four decimals here, never
 * fewer than the usual two.
 */
export function formatUnitPrice(
  locale: string,
  amount: number | Decimal,
  currency: string,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}
