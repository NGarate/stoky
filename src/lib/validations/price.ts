import { z } from "zod";
import { MAX_DAYS, MAX_PRICE } from "./bounds";

export const priceRecordSchema = z.object({
  productId: z.string(),
  storeId: z.string(),
  price: z.number().positive().finite().max(MAX_PRICE),
  currency: z.string().default("EUR"),
  unit: z.string(),
  quantity: z.number().positive().default(1),
});

export const priceQuerySchema = z.object({
  productId: z.string(),
  storeId: z.string().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

export const priceHistorySchema = z.object({
  productId: z.string(),
  storeId: z.string().optional(),
  days: z.number().int().min(1).max(MAX_DAYS).default(90),
});

export type PriceRecordInput = z.infer<typeof priceRecordSchema>;
export type PriceQueryInput = z.infer<typeof priceQuerySchema>;
export type PriceHistoryInput = z.infer<typeof priceHistorySchema>;
