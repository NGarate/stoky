import { describe, expect, it } from "bun:test";
import { priceRecordSchema } from "@/lib/validations/price";

/**
 * A `PriceRecord`'s `price` is what was paid for `quantity` units, so every
 * comparison divides by `quantity`. Zero makes that division infinite and a
 * negative quantity makes a price negative, so neither can be recorded.
 */
describe("priceRecordSchema.quantity", () => {
  const base = { productId: "p", storeId: "s", price: 1.5, unit: "L" };

  it("defaults to one", () => {
    expect(priceRecordSchema.parse(base).quantity).toBe(1);
  });

  it("accepts a positive quantity", () => {
    expect(priceRecordSchema.parse({ ...base, quantity: 6 }).quantity).toBe(6);
  });

  it.each([0, -1, -0.5])("refuses %p", (quantity) => {
    expect(priceRecordSchema.safeParse({ ...base, quantity }).success).toBe(false);
  });
});
