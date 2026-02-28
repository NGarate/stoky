import { z } from "zod";

export const storeSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
});

export const updateStoreSchema = storeSchema.partial().extend({
  id: z.string(),
});

export const storeQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.number().default(20),
});

export type StoreInput = z.infer<typeof storeSchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
export type StoreQueryInput = z.infer<typeof storeQuerySchema>;
