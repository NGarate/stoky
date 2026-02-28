import { z } from "zod";

export const priceRecordSchema = z.object({
  productId: z.string(),
  storeId: z.string(),
  price: z.number().positive(),
  currency: z.string().default("EUR"),
  unit: z.string(),
  quantity: z.number().default(1),
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
  days: z.number().default(90),
});

export type PriceRecordInput = z.infer<typeof priceRecordSchema>;
export type PriceQueryInput = z.infer<typeof priceQuerySchema>;
export type PriceHistoryInput = z.infer<typeof priceHistorySchema>;
