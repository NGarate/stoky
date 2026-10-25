import { z } from "zod";
import {
  MAX_DAYS,
  MAX_ID_LENGTH,
  MAX_PRICE,
  MAX_QUANTITY,
  MAX_UNIT_LENGTH,
} from "./bounds";

/**
 * An ISO 4217 code: three letters. Normalised before it is checked, so a
 * client that sends "eur" is not newly refused, and what is stored is what
 * `Intl.NumberFormat` takes. It was any string, of any length.
 */
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3)
  .regex(/^[A-Z]{3}$/, "Not a currency code");

export const priceRecordSchema = z.object({
  productId: z.string().max(MAX_ID_LENGTH),
  storeId: z.string().max(MAX_ID_LENGTH),
  price: z.number().positive().finite().max(MAX_PRICE),
  currency: currencySchema.default("EUR"),
  unit: z.string().max(MAX_UNIT_LENGTH),
  quantity: z.number().positive().finite().max(MAX_QUANTITY).default(1),
});

export const priceQuerySchema = z.object({
  productId: z.string().max(MAX_ID_LENGTH),
  storeId: z.string().max(MAX_ID_LENGTH).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

export const priceHistorySchema = z.object({
  productId: z.string().max(MAX_ID_LENGTH),
  storeId: z.string().max(MAX_ID_LENGTH).optional(),
  days: z.number().int().min(1).max(MAX_DAYS).default(90),
});

export type PriceRecordInput = z.infer<typeof priceRecordSchema>;
export type PriceQueryInput = z.infer<typeof priceQuerySchema>;
export type PriceHistoryInput = z.infer<typeof priceHistorySchema>;
