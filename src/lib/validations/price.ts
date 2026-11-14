import { z } from "zod";
import { MAX_DAYS, MAX_ID_LENGTH } from "./bounds";

export const priceHistorySchema = z.object({
  productId: z.string().max(MAX_ID_LENGTH),
  storeId: z.string().max(MAX_ID_LENGTH).optional(),
  days: z.number().int().min(1).max(MAX_DAYS).default(90),
});
