import { describe, expect, it } from "bun:test";
import { toChartPoints, unitPrice, withUnitPrices } from "@/lib/prices/unitPrice";

/** `PriceRecord.price` is a total for `quantity` units; these divide it once. */
describe("unitPrice", () => {
  it("divides the total paid by the quantity bought", () => {
    expect(unitPrice(5.34, 6)).toBeCloseTo(0.89, 10);
    expect(unitPrice(0.99, 1)).toBe(0.99);
  });

  it("has no answer for a quantity that is not positive", () => {
    expect(unitPrice(1, 0)).toBeNull();
    expect(unitPrice(1, -2)).toBeNull();
  });
});

describe("withUnitPrices", () => {
  it("attaches the unit price and drops the rows that have none", () => {
    const rows = withUnitPrices([
      { id: "pack", price: 5.34, quantity: 6 },
      { id: "broken", price: 1, quantity: 0 },
    ]);

    expect(rows.map((row) => row.id)).toEqual(["pack"]);
    expect(rows[0]?.unitPrice).toBeCloseTo(0.89, 10);
  });
});

describe("toChartPoints", () => {
  it("plots the unit price, not the total paid", () => {
    const [point] = toChartPoints([
      {
        recordedAt: new Date("2026-08-01T10:00:00.000Z"),
        unitPrice: 0.89,
        store: { name: "Mercadona" },
      },
    ]);

    expect(point).toEqual({
      date: "2026-08-01T10:00:00.000Z",
      price: 0.89,
      storeName: "Mercadona",
    });
  });
});
