import type { api } from "./client";

/**
 * What a write makes stale, said once per kind of write.
 *
 * Each direct mutation used to name the queries it remembered: adding stock
 * refreshed the inventory overview and nothing else, so the product page, the
 * expiry lists, the shopping list's "en casa" figures and the catalogue all
 * kept the number from before the write; reconciling a refused consumption
 * refreshed nothing at all; applying a receipt moved stock and prices and
 * refreshed neither. A list per call site is a list that is wrong at most of
 * them, so the answer lives here, by router — an over-wide invalidation costs
 * a refetch of what is on screen, and a narrow one costs a wrong number.
 *
 * The queue's drain needs none of this: it invalidates everything once per
 * settled drain (`WriteQueueProvider`).
 */

type Utils = ReturnType<typeof api.useUtils>;

/** Anything that moves stock: adding, consuming, adjusting. */
export function invalidateAfterStockChange(
  utils: Pick<Utils, "inventory" | "product" | "shopping">,
): Promise<unknown> {
  return Promise.all([
    utils.inventory.invalidate(),
    // Product pages show the batches, the catalogue shows totals.
    utils.product.invalidate(),
    // The buy list reads stock against each minimum.
    utils.shopping.invalidate(),
  ]);
}

/** Applying a receipt: stock, prices and the receipt itself all move. */
export function invalidateAfterReceiptApplied(
  utils: Pick<Utils, "inventory" | "product" | "shopping" | "price" | "receipt">,
): Promise<unknown> {
  return Promise.all([
    invalidateAfterStockChange(utils),
    utils.price.invalidate(),
    utils.receipt.invalidate(),
  ]);
}

/** A scan that may have created a product the catalogue has not seen. */
export function invalidateAfterProductCreated(
  utils: Pick<Utils, "product">,
): Promise<unknown> {
  return utils.product.invalidate();
}
