/**
 * When a product counts as running out.
 *
 * Two questions, deliberately distinct, and the distinction is the whole
 * reason this file exists:
 *
 * - **`isLowStock`** — below a minimum somebody actually set. This is the
 *   phone screen's "to buy" section and the kitchen's "se está acabando".
 *   A product with no minimum is never low, because nothing said what low
 *   would mean for it.
 * - **`needsRestock`** — that, **plus everything at or below zero even with
 *   no minimum set**. A product that has run out without a minimum would
 *   otherwise never appear anywhere, which is the Panel's concern.
 *
 * They were three implementations before this: `getStockOverview` had the
 * canonical pair, `shopping.generateFromLowStock` re-derived one as
 * `currentStock < (minStock || 0)`, and two product screens each wrote the
 * comparison inline. The three agreed — checked case by case, including the
 * null and zero minimums where `|| 0` and `!== null` could have diverged —
 * so this extraction changes no behaviour. That they agreed was luck rather
 * than design: nothing made them, and a fourth caller had no way to know
 * which of the three to copy.
 *
 * Kept as plain arithmetic over two numbers rather than over a product, so
 * the server can apply it to a row it has just summed and a component can
 * apply it to what a query returned, without either shaping data for the
 * other.
 */

/**
 * Below a minimum that was set. Never true when no minimum exists.
 *
 * Typed as a predicate over `minStock` rather than as a plain boolean,
 * because it is one: a true answer *means* there is a minimum. Saying so
 * lets a caller report the number afterwards — "quedan 1 de un mínimo de 2"
 * — without repeating the null check the compiler would otherwise demand,
 * which is precisely the duplication this file exists to remove.
 */
export function isLowStock(
  totalStock: number,
  minStock: number | null,
): minStock is number {
  return minStock !== null && totalStock < minStock;
}

/**
 * Low, or run out with nobody having said what low means.
 *
 * A separate predicate rather than a widening of `isLowStock`, because the
 * kitchen screen reads `isLowStock` and silently changing what an existing
 * consumer sees is how a green suite stops meaning anything.
 */
export function needsRestock(
  totalStock: number,
  minStock: number | null,
): boolean {
  return totalStock <= 0 || isLowStock(totalStock, minStock);
}
