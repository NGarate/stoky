import { Decimal } from "@prisma/client-runtime-utils";
import { z } from "zod";
import { MAX_PRICE, MAX_QUANTITY } from "./bounds";

/** Decimals a quantity column keeps (`@db.Decimal(12, 3)`): a gram of a kilo. */
export const QUANTITY_PLACES = 3;

/** Decimals a money column keeps (`@db.Decimal(12, 2)`): a cent. */
export const MONEY_PLACES = 2;

/**
 * A number from the wire as the exact amount its column will hold.
 *
 * Rounded here, once, so what a handler checks is what Postgres stores. Left
 * to the column, a guard could accept 0.0004 and the row hold 0, or compare
 * against one figure and write another.
 */
export function atScale(places: number) {
  return (value: number) => new Decimal(value).toDecimalPlaces(places);
}

/** An amount bought, used or wanted: more than zero once at scale. */
export const quantitySchema = z
  .number()
  .finite()
  .max(MAX_QUANTITY)
  .transform(atScale(QUANTITY_PLACES))
  .refine((value) => value.greaterThan(0), "Must be more than zero");

/** A minimum to keep in stock. Zero is a minimum; below it is not. */
export const minStockSchema = z
  .number()
  .finite()
  .min(0)
  .max(MAX_QUANTITY)
  .transform(atScale(QUANTITY_PLACES));

/** What was paid. A zero or negative price is refused (PRICE-1). */
export const priceSchema = z
  .number()
  .finite()
  .max(MAX_PRICE)
  .transform(atScale(MONEY_PLACES))
  .refine((value) => value.greaterThan(0), "Must be more than zero");
