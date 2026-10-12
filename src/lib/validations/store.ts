import { z } from "zod";
import {
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
} from "./bounds";

export const storeSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  address: z.string().max(MAX_NOTE_LENGTH).optional(),
});

export const updateStoreSchema = storeSchema.partial().extend({
  id: z.string().max(MAX_ID_LENGTH),
});

export const storeQuerySchema = z.object({
  search: z.string().trim().max(MAX_SEARCH_LENGTH).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type StoreInput = z.infer<typeof storeSchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
export type StoreQueryInput = z.infer<typeof storeQuerySchema>;
