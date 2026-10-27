import { describe, expect, it } from "bun:test";
import {
  minStockSchema,
  priceSchema,
  quantitySchema,
} from "@/lib/validations/amounts";

/**
 * A number is put at its column's scale once, at the edge, so what a handler
 * checks is what Postgres stores — not 0.0004 checked and 0 stored.
 */
describe("amounts at the column's scale", () => {
  it("keeps a quantity to the thousandth, exactly", () => {
    expect(quantitySchema.parse(0.1234).toString()).toBe("0.123");
    // 0.1 + 0.2 in floats; the column holds 0.3, and so does the handler.
    expect(quantitySchema.parse(0.1 + 0.2).toString()).toBe("0.3");
  });

  it("refuses a quantity that rounds to nothing", () => {
    expect(quantitySchema.safeParse(0.0004).success).toBe(false);
    expect(quantitySchema.safeParse(0).success).toBe(false);
    expect(quantitySchema.safeParse(-1).success).toBe(false);
  });

  it("keeps a price to the cent", () => {
    expect(priceSchema.parse(1.005).toString()).toBe("1.01");
    expect(priceSchema.safeParse(0.004).success).toBe(false);
  });

  it("takes zero as a minimum, and nothing below it", () => {
    expect(minStockSchema.parse(0).toString()).toBe("0");
    expect(minStockSchema.safeParse(-0.5).success).toBe(false);
  });
});
