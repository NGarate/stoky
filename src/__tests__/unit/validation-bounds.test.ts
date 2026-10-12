import { describe, it, expect } from "bun:test";
import {
  productByBarcodeSchema,
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
import {
  shoppingItemSchema,
  shoppingListSchema,
  updateShoppingItemSchema,
  updateShoppingListSchema,
} from "@/lib/validations/shopping";
import { storeSchema, updateStoreSchema } from "@/lib/validations/store";
import {
  storageLocationSchema,
  stockOverviewSchema,
  updateStorageLocationSchema,
} from "@/lib/validations/inventory";
import { createHouseholdSchema, loginSchema, registerSchema } from "@/lib/validations/auth";
import {
  addMemberSchema,
  householdSchema,
  removeMemberSchema,
  updateHouseholdSchema,
  updateMemberRoleSchema,
} from "@/lib/validations/household";
import { receiptItemMatchSchema } from "@/lib/validations/receipt";
import { replayable } from "@/lib/validations/idempotency";
import {
  MAX_BARCODE_LENGTH,
  MAX_DAYS,
  MAX_EMAIL_LENGTH,
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PAGE_SIZE,
  MAX_QUANTITY,
  MAX_SEARCH_LENGTH,
  MAX_UNIT_LENGTH,
} from "@/lib/validations/bounds";

/**
 * The edges of every shared input schema — `src/lib/validations/bounds.ts`.
 *
 * Each case is a value the schema used to accept: Infinity through
 * `.positive()`, a negative or fractional page size that went into `LIMIT`, a
 * day window that made an Invalid Date, a barcode that became part of an
 * outbound URL, a name or an address of any length. The procedures that
 * declare their schema inline are covered through the router in
 * `integration/input-bounds.test.ts`, and `procedure-input-bounds.test.ts`
 * walks every procedure's parser for a string or array with no maximum.
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
    // The divisor of every unit price: Infinity made a real price read as 0 €
    // per unit, the best price on the screen, and the premiums beside it NaN.
    expect(
      accepts(priceRecordSchema, { productId: "p", storeId: "s", price: 1, unit: "unidad", quantity: Infinity }),
    ).toBe(false);
    expect(accepts(updateProductSchema, { id: "p", minStock: Infinity })).toBe(false);
  });

  it("refuses an amount past the ceiling and keeps the ordinary ones", () => {
    expect(accepts(addStockSchema, { ...stock, quantity: MAX_QUANTITY + 1 })).toBe(false);
    expect(accepts(addStockSchema, { ...stock, quantity: MAX_QUANTITY })).toBe(true);
    expect(accepts(addStockSchema, { ...stock, quantity: 0.5 })).toBe(true);
    expect(
      accepts(priceRecordSchema, { productId: "p", storeId: "s", price: 1, unit: "unidad", quantity: MAX_QUANTITY + 1 }),
    ).toBe(false);
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

describe("a barcode is a product barcode", () => {
  it("takes the GTIN lengths a food label carries", () => {
    for (const barcode of ["012345", "96385074", "036000291452", "8410000678901", "18410000678908"]) {
      expect(accepts(productByBarcodeSchema, { barcode })).toBe(true);
    }
  });

  it("trims what a phone keyboard adds", () => {
    expect(productByBarcodeSchema.parse({ barcode: " 8410000678901 " }).barcode).toBe("8410000678901");
  });

  it("refuses anything that would change the shape of the lookup URL", () => {
    // It was interpolated into the path of the request to Open Food Facts.
    for (const barcode of ["../../search", "8410000678901?x=1", "84100/00678", "", "12345", "1".repeat(15)]) {
      expect(accepts(productByBarcodeSchema, { barcode })).toBe(false);
    }
  });
});

/**
 * An address of exactly `length` characters that `.email()` still accepts:
 * the length test should be what refuses it, not the syntax.
 */
function emailOfLength(length: number): string {
  const domain = "@example.es";
  return "a".repeat(length - domain.length) + domain;
}

describe("stored text has a maximum length", () => {
  // Every field that used to be a bare `z.string()`. For each one the bound
  // itself is accepted — so a limit cannot be set below a value that is
  // real — and one character over is refused. `base` is the smallest valid
  // input, so a refusal can only be about the field under test.
  type Schema = { safeParse: (v: unknown) => { success: boolean } };
  const cases: [label: string, schema: Schema, base: Record<string, unknown>, field: string, max: number][] = [
    ["product name", productSchema, {}, "name", MAX_NAME_LENGTH],
    ["product brand", productSchema, { name: "Leche" }, "brand", MAX_NAME_LENGTH],
    ["product category", productSchema, { name: "Leche" }, "category", MAX_NAME_LENGTH],
    ["product barcode", productSchema, { name: "Leche" }, "barcode", MAX_BARCODE_LENGTH],
    ["product unit", productSchema, { name: "Leche" }, "defaultUnit", MAX_UNIT_LENGTH],
    ["product id on edit", updateProductSchema, {}, "id", MAX_ID_LENGTH],
    ["barcode on edit", updateProductSchema, { id: "p" }, "barcode", MAX_BARCODE_LENGTH],
    ["product page cursor", productPaginationSchema, {}, "cursor", MAX_ID_LENGTH],
    ["store name", storeSchema, {}, "name", MAX_NAME_LENGTH],
    ["store address", storeSchema, { name: "Mercadona" }, "address", MAX_NOTE_LENGTH],
    ["store id on edit", updateStoreSchema, {}, "id", MAX_ID_LENGTH],
    ["location name", storageLocationSchema, {}, "name", MAX_NAME_LENGTH],
    ["location parent", storageLocationSchema, { name: "Nevera" }, "parentId", MAX_ID_LENGTH],
    ["location id on edit", updateStorageLocationSchema, {}, "id", MAX_ID_LENGTH],
    ["stock product", addStockSchema, { ...stock, quantity: 1 }, "productId", MAX_ID_LENGTH],
    ["stock unit", addStockSchema, { ...stock, quantity: 1 }, "unit", MAX_UNIT_LENGTH],
    ["stock location", addStockSchema, { ...stock, quantity: 1 }, "locationId", MAX_ID_LENGTH],
    ["stock note", addStockSchema, { ...stock, quantity: 1 }, "note", MAX_NOTE_LENGTH],
    ["consumed batch", consumeStockSchema, { ...stock, quantity: 1 }, "batchId", MAX_ID_LENGTH],
    ["adjustment reason", adjustStockSchema, { ...stock, quantity: 1 }, "reason", MAX_NOTE_LENGTH],
    ["stock filter category", stockOverviewSchema, {}, "category", MAX_NAME_LENGTH],
    ["stock filter location", stockOverviewSchema, {}, "locationId", MAX_ID_LENGTH],
    ["price product", priceRecordSchema, { storeId: "s", price: 1, unit: "u" }, "productId", MAX_ID_LENGTH],
    ["price store", priceRecordSchema, { productId: "p", price: 1, unit: "u" }, "storeId", MAX_ID_LENGTH],
    ["price unit", priceRecordSchema, { productId: "p", storeId: "s", price: 1 }, "unit", MAX_UNIT_LENGTH],
    ["price history product", priceHistorySchema, {}, "productId", MAX_ID_LENGTH],
    ["list name", shoppingListSchema, {}, "name", MAX_NAME_LENGTH],
    ["list id on edit", updateShoppingListSchema, {}, "id", MAX_ID_LENGTH],
    ["list item list", shoppingItemSchema, { productId: "p" }, "shoppingListId", MAX_ID_LENGTH],
    ["list item product", shoppingItemSchema, { shoppingListId: "l" }, "productId", MAX_ID_LENGTH],
    ["list item unit", shoppingItemSchema, { shoppingListId: "l", productId: "p" }, "unit", MAX_UNIT_LENGTH],
    ["list item store", shoppingItemSchema, { shoppingListId: "l", productId: "p" }, "storeId", MAX_ID_LENGTH],
    ["list item id on edit", updateShoppingItemSchema, {}, "id", MAX_ID_LENGTH],
    ["list item unit on edit", updateShoppingItemSchema, { id: "i" }, "quantityUnit", MAX_UNIT_LENGTH],
    ["registered name", registerSchema, { email: "a@example.es", password: "una frase larga" }, "name", MAX_NAME_LENGTH],
    [
      "registered household",
      registerSchema,
      { email: "a@example.es", name: "Ana", password: "una frase larga" },
      "householdName",
      MAX_NAME_LENGTH,
    ],
    ["new household", createHouseholdSchema, {}, "name", MAX_NAME_LENGTH],
    ["household name", householdSchema, {}, "name", MAX_NAME_LENGTH],
    ["household id", updateHouseholdSchema, {}, "id", MAX_ID_LENGTH],
    ["member name", addMemberSchema, { email: "a@example.es", password: "una frase larga", role: "MEMBER" }, "name", MAX_NAME_LENGTH],
    ["member whose role changes", updateMemberRoleSchema, { role: "MEMBER" }, "userId", MAX_ID_LENGTH],
    ["member removed", removeMemberSchema, {}, "userId", MAX_ID_LENGTH],
    ["receipt line", receiptItemMatchSchema, { action: "SKIP" }, "receiptItemId", MAX_ID_LENGTH],
    ["receipt match", receiptItemMatchSchema, { action: "MATCH", receiptItemId: "r" }, "productId", MAX_ID_LENGTH],
    ["receipt new product", receiptItemMatchSchema, { action: "CREATE", receiptItemId: "r" }, "customName", MAX_NAME_LENGTH],
  ];

  for (const [label, schema, base, field, max] of cases) {
    it(`${label}: ${max} accepted, ${max + 1} refused`, () => {
      expect(accepts(schema, { ...base, [field]: "c".repeat(max) })).toBe(true);
      expect(accepts(schema, { ...base, [field]: "c".repeat(max + 1) })).toBe(false);
    });
  }

  it("bounds an address at RFC 5321's 254, everywhere one is taken", () => {
    // Sign-in parses it without an account, and a failed sign-in logs it.
    const password = "una frase larga";
    for (const [schema, rest] of [
      [loginSchema, { password }],
      [registerSchema, { name: "Ana", password }],
      [addMemberSchema, { name: "Ana", password, role: "MEMBER" }],
    ] as const) {
      expect(accepts(schema, { ...rest, email: emailOfLength(MAX_EMAIL_LENGTH) })).toBe(true);
      expect(accepts(schema, { ...rest, email: emailOfLength(MAX_EMAIL_LENGTH + 1) })).toBe(false);
    }
  });

  it("measures an address after trimming it, as it is stored", () => {
    expect(accepts(loginSchema, { email: `  ${emailOfLength(MAX_EMAIL_LENGTH)}  `, password: "x" })).toBe(true);
  });

  it("bounds the account a queued change names, which .cuid() alone did not", () => {
    const key = "3f1a9d1e-4c2b-4a5e-9d3f-2b7c8e1a4f60";
    expect(accepts(replayable, { idempotencyKey: key, composedByUserId: "clzzzzzzzzzzzzzzzzzzzzzzz" })).toBe(true);
    expect(accepts(replayable, { idempotencyKey: key, composedByUserId: `c${"z".repeat(MAX_ID_LENGTH)}` })).toBe(false);
  });

  it("keeps a barcode a product's own label carries, which the lookup would refuse", () => {
    // Shop labels and hand-typed codes are not GTINs; only the Open Food
    // Facts lookup needs digits.
    for (const barcode of ["1", "123456789", "PLU-4011", "2000000000015"]) {
      expect(accepts(productSchema, { name: "Plátano", barcode })).toBe(true);
    }
    expect(accepts(productByBarcodeSchema, { barcode: "1".repeat(MAX_BARCODE_LENGTH + 1) })).toBe(false);
  });
});

describe("a currency is a three-letter code", () => {
  const record = { productId: "p", storeId: "s", price: 1, unit: "unidad" };
  const currencyOf = (currency: unknown) =>
    priceRecordSchema.safeParse({ ...record, currency });

  it("defaults to euros and normalises what a client sends", () => {
    expect(priceRecordSchema.parse(record).currency).toBe("EUR");
    // A lowercase code was accepted before, so it must not be refused now.
    expect(currencyOf(" eur ").data?.currency).toBe("EUR");
    expect(currencyOf("usd").data?.currency).toBe("USD");
  });

  it("refuses anything that is not three letters", () => {
    for (const currency of ["EURO", "EU", "€", "E1R", "", "E".repeat(1_000_000)]) {
      expect(currencyOf(currency).success).toBe(false);
    }
  });
});
