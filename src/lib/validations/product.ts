import { z } from "zod";

export const productSchema = z.object({
  name: z.string().min(1),
  barcode: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  defaultUnit: z.string().default("unit"),
  minStock: z.number().optional(),
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
  id: z.string(),
  barcode: z.string().min(1).nullish(),
  brand: z.string().min(1).nullish(),
  category: z.string().min(1).nullish(),
  minStock: z.number().min(0).nullish(),
});

export const productSearchSchema = z.object({
  query: z.string(),
  limit: z.number().default(10),
});

export const productByBarcodeSchema = z.object({
  barcode: z.string(),
});

export const productPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().min(1).max(100).default(20),
  search: z.string().optional(),
});

export const productListSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().min(1).max(100).default(20),
  search: z.string().optional(),
});

export type ProductInput = z.infer<typeof productSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductSearchInput = z.infer<typeof productSearchSchema>;
export type ProductByBarcodeInput = z.infer<typeof productByBarcodeSchema>;
export type ProductPaginationInput = z.infer<typeof productPaginationSchema>;
export type ProductListInput = z.infer<typeof productListSchema>;
