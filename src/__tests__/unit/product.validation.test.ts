import { describe, it, expect } from "bun:test";
import {
  updateProductSchema,
  resolveScanSchema,
} from "@/lib/validations/product";

/**
 * Phase 8 item 1 — editing needs to be able to *clear* a field, not only
 * change it.
 *
 * `update` spreads the parsed input into `prisma.product.update`, where
 * `undefined` means "leave it alone". So before this schema accepted `null`,
 * there was no way to remove a wrong barcode: omitting the field kept it, and
 * sending `""` would have stored an empty string into the
 * `[barcode, householdId]` unique index — letting the first product without a
 * code claim it and every later one collide (the create form refuses "" for
 * exactly that reason).
 */
describe("updateProductSchema", () => {
  it("accepts null to clear the optional fields", () => {
    const parsed = updateProductSchema.parse({
      id: "p1",
      barcode: null,
      brand: null,
      category: null,
      minStock: null,
    });

    expect(parsed.barcode).toBeNull();
    expect(parsed.brand).toBeNull();
    expect(parsed.category).toBeNull();
    expect(parsed.minStock).toBeNull();
  });

  it("still treats an omitted field as untouched, not cleared", () => {
    const parsed = updateProductSchema.parse({ id: "p1", name: "Lentejas" });

    expect(parsed.name).toBe("Lentejas");
    expect("barcode" in parsed && parsed.barcode !== undefined).toBe(false);
  });

  it("refuses an empty-string barcode — clearing is null, not \"\"", () => {
    expect(() =>
      updateProductSchema.parse({ id: "p1", barcode: "" }),
    ).toThrow();
  });

  it("refuses a negative minimum", () => {
    expect(() =>
      updateProductSchema.parse({ id: "p1", minStock: -1 }),
    ).toThrow();
  });
});

/**
 * T7 — the replayable scan carries the idempotency envelope, because it drains
 * from the offline queue and must be safe to replay.
 */
describe("resolveScanSchema", () => {
  const key = "3f1a9d1e-4c2b-4a5e-9d3f-2b7c8e1a4f60";
  const user = "clzzzzzzzzzzzzzzzzzzzzzzz";

  it("requires a well-formed key and a composer", () => {
    expect(
      resolveScanSchema.safeParse({ barcode: "8410000678901" }).success,
    ).toBe(false);
    expect(
      resolveScanSchema.safeParse({
        barcode: "8410000678901",
        idempotencyKey: "not-a-uuid",
        composedByUserId: user,
      }).success,
    ).toBe(false);
  });

  it("accepts a barcode with the envelope", () => {
    expect(
      resolveScanSchema.safeParse({
        barcode: "8410000678901",
        idempotencyKey: key,
        composedByUserId: user,
      }).success,
    ).toBe(true);
  });
});
