import { describe, it, expect } from "bun:test";
import {
  productPaginationSchema,
  productSchema,
  productSearchSchema,
  updateProductSchema,
} from "@/lib/validations/product";
import { storeQuerySchema } from "@/lib/validations/store";
import { priceHistorySchema, priceRecordSchema } from "@/lib/validations/price";
import {
  addStockSchema,
  adjustStockSchema,
  consumeStockSchema,
} from "@/lib/validations/inventory";
import { shoppingItemSchema, updateShoppingItemSchema } from "@/lib/validations/shopping";
import {
  MAX_DAYS,
  MAX_PAGE_SIZE,
  MAX_QUANTITY,
  MAX_SEARCH_LENGTH,
} from "@/lib/validations/bounds";

/**
 * The edges of every shared input schema — `src/lib/validations/bounds.ts`.
 *
 * Each case is a value the schema used to accept: Infinity through
 * `.positive()`, a negative or fractional page size that went into `LIMIT`, a
 * day window that made an Invalid Date. The procedures that declare their
 * schema inline are covered through the router in
 * `integration/input-bounds.test.ts`.
 */

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

const stock = { productId: "p1", unit: "unidad" };

describe("quantities and prices are finite and bounded", () => {
  it("refuses Infinity wherever a quantity is taken", () => {
    expect(accepts(addStockSchema, { ...stock, quantity: Infinity })).toBe(false);
    expect(accepts(consumeStockSchema, { ...stock, quantity: Infinity })).toBe(false);
    expect(accepts(adjustStockSchema, { ...stock, quantity: -Infinity, reason: "recuento" })).toBe(false);
    expect(
      accepts(adjustStockSchema, { ...stock, quantity: 1, expectedStock: Infinity, reason: "recuento" }),
    ).toBe(false);
    expect(accepts(shoppingItemSchema, { shoppingListId: "l", productId: "p", quantity: Infinity })).toBe(false);
    expect(
      accepts(updateShoppingItemSchema, { id: "i", quantity: Infinity, quantityUnit: "unidad" }),
    ).toBe(false);
    expect(accepts(productSchema, { name: "Leche", minStock: Infinity })).toBe(false);
    expect(accepts(updateProductSchema, { id: "p", minStock: Infinity })).toBe(false);
  });

  it("refuses an amount past the ceiling and keeps the ordinary ones", () => {
    expect(accepts(addStockSchema, { ...stock, quantity: MAX_QUANTITY + 1 })).toBe(false);
    expect(accepts(addStockSchema, { ...stock, quantity: MAX_QUANTITY })).toBe(true);
    expect(accepts(addStockSchema, { ...stock, quantity: 0.5 })).toBe(true);
    // Signed, so a reconciliation downwards still passes.
    expect(accepts(adjustStockSchema, { ...stock, quantity: -3, reason: "recuento" })).toBe(true);
  });

  it("refuses an infinite price", () => {
    const record = { productId: "p", storeId: "s", unit: "unidad" };
    expect(accepts(priceRecordSchema, { ...record, price: Infinity })).toBe(false);
    expect(accepts(priceRecordSchema, { ...record, price: 1.29 })).toBe(true);
  });
});

describe("a minimum stock is never negative", () => {
  it("refuses it on create as it already did on edit", () => {
    // Create accepted -3 while edit refused it, so a product could be made
    // that could not be saved again unchanged.
    expect(accepts(productSchema, { name: "Leche", minStock: -3 })).toBe(false);
    expect(accepts(updateProductSchema, { id: "p", minStock: -3 })).toBe(false);
    expect(accepts(productSchema, { name: "Leche", minStock: 0 })).toBe(true);
  });
});

describe("page sizes, windows and searches are bounded", () => {
  it("refuses a page size that is negative, fractional or enormous", () => {
    // searchByName puts `limit` into `LIMIT ${…}`: -1 was a Postgres error.
    for (const limit of [-1, 0, 1.5, MAX_PAGE_SIZE + 1, 1e9]) {
      expect(accepts(productSearchSchema, { query: "leche", limit })).toBe(false);
      expect(accepts(storeQuerySchema, { limit })).toBe(false);
      expect(accepts(productPaginationSchema, { limit })).toBe(false);
    }
    expect(accepts(productSearchSchema, { query: "leche", limit: 10 })).toBe(true);
    expect(accepts(storeQuerySchema, { limit: MAX_PAGE_SIZE })).toBe(true);
  });

  it("refuses a day window that cannot become a date", () => {
    // `new Date().setDate(-1e12)` is an Invalid Date that reached Prisma.
    for (const days of [1e12, -5, 0, 2.5, MAX_DAYS + 1]) {
      expect(accepts(priceHistorySchema, { productId: "p", days })).toBe(false);
    }
    expect(accepts(priceHistorySchema, { productId: "p", days: 90 })).toBe(true);
  });

  it("refuses a search string no search box sends", () => {
    const long = "a".repeat(MAX_SEARCH_LENGTH + 1);
    expect(accepts(productSearchSchema, { query: long })).toBe(false);
    expect(accepts(storeQuerySchema, { search: long })).toBe(false);
    expect(accepts(productPaginationSchema, { search: long })).toBe(false);
    expect(accepts(productSearchSchema, { query: "leche entera" })).toBe(true);
  });
});
