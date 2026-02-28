import { z } from "zod";

export const stockOperationSchema = z.enum(["PURCHASE", "CONSUME", "ADJUST", "TRANSFER"]);

export const stockEntrySchema = z.object({
  productId: z.string(),
  quantity: z.number(),
  unit: z.string(),
  expirationDate: z.date().optional(),
  locationId: z.string().optional(),
  operationType: stockOperationSchema,
  note: z.string().optional(),
});

export const storageLocationSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().optional(),
});

export const updateStorageLocationSchema = storageLocationSchema.partial().extend({
  id: z.string(),
});

export type StockEntryInput = z.infer<typeof stockEntrySchema>;
export type StorageLocationInput = z.infer<typeof storageLocationSchema>;
export type UpdateStorageLocationInput = z.infer<typeof updateStorageLocationSchema>;
