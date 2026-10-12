import { z } from "zod";
import {
  MAX_BARCODE_LENGTH,
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PAGE_SIZE,
  MAX_QUANTITY,
  MAX_SEARCH_LENGTH,
  MAX_UNIT_LENGTH,
} from "./bounds";
import { replayable } from "./idempotency";

export const productSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  // A length, not the GTIN pattern `productByBarcodeSchema` uses: a shop's own
  // label or a hand-typed internal code is a barcode somebody keeps too.
  barcode: z.string().max(MAX_BARCODE_LENGTH).optional(),
  brand: z.string().max(MAX_NAME_LENGTH).optional(),
  category: z.string().max(MAX_NAME_LENGTH).optional(),
  defaultUnit: z.string().trim().min(1).max(MAX_UNIT_LENGTH).default("unit"),
  // `.min(0)` here as well as on update: a minimum of minus three was
  // accepted on create and refused on edit, so the product could be made but
  // not saved again without changing it.
  minStock: z.number().finite().min(0).max(MAX_QUANTITY).optional(),
});

/**
 * Editing must be able to *clear* a field, not only change it. The resolver
 * spreads this into `prisma.product.update`, where `undefined` leaves a column
 * untouched — so `null` is the only honest way to say "remove it". `""` is
 * refused for the barcode because the column sits in the
 * `[barcode, householdId]` unique index: storing an empty string would let the
 * first product without a code claim it and every later one collide, which is
 * the same reasoning the create form applies before submitting.
 */
export const updateProductSchema = productSchema.partial().extend({
  id: z.string().max(MAX_ID_LENGTH),
  barcode: z.string().min(1).max(MAX_BARCODE_LENGTH).nullish(),
  brand: z.string().min(1).max(MAX_NAME_LENGTH).nullish(),
  category: z.string().min(1).max(MAX_NAME_LENGTH).nullish(),
  minStock: z.number().finite().min(0).max(MAX_QUANTITY).nullish(),
});

export const productSearchSchema = z.object({
  query: z.string().trim().min(1).max(MAX_SEARCH_LENGTH),
  // Interpolated into `LIMIT ${…}` by `searchByName`: parameterised, so not an
  // injection, but -1 was a Postgres error and a billion was every row.
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(10),
});

/**
 * A GTIN — EAN-8, EAN-13, UPC-A/E, GTIN-14 — which is what a food label
 * carries and the only thing Open Food Facts can look up.
 *
 * It was any string, and `getProductByBarcode` put it in the path of the
 * request it makes to Open Food Facts: `../` and `?` from a caller became
 * part of an outbound URL from this server. Digits only closes that at the
 * edge, and the client encodes it as well. Trimmed first, because the manual
 * entry box is typed on a phone.
 */
export const productByBarcodeSchema = z.object({
  // The pattern already caps it at fourteen; the `.max` is there so the
  // bound is a check every schema walk can see, not a property of a regex.
  barcode: z
    .string()
    .trim()
    .max(MAX_BARCODE_LENGTH)
    .regex(/^\d{6,14}$/, "Not a product barcode"),
});

/**
 * A barcode scanned offline, resolved on reconnect (T7).
 *
 * The same barcode `scanBarcode` takes, plus the replay envelope — because
 * unlike `scanBarcode`, this one is drained from the offline queue, so it must
 * be idempotent. It is a queued *scan*, never a queued product: the queue
 * carries a barcode, and the real product (with its server-minted id) comes
 * into being only when the scan resolves, so no provisional id ever reaches a
 * component or the query cache.
 */
export const resolveScanSchema = productByBarcodeSchema.merge(replayable);

export const productPaginationSchema = z.object({
  cursor: z.string().max(MAX_ID_LENGTH).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  search: z.string().max(MAX_SEARCH_LENGTH).optional(),
});

export const productListSchema = z.object({
  cursor: z.string().max(MAX_ID_LENGTH).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  search: z.string().max(MAX_SEARCH_LENGTH).optional(),
});

export type ProductInput = z.infer<typeof productSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductSearchInput = z.infer<typeof productSearchSchema>;
export type ProductByBarcodeInput = z.infer<typeof productByBarcodeSchema>;
export type ResolveScanInput = z.infer<typeof resolveScanSchema>;
export type ProductPaginationInput = z.infer<typeof productPaginationSchema>;
export type ProductListInput = z.infer<typeof productListSchema>;
