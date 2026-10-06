import { describe, expect, it } from "bun:test";
import { inUnit, toChartPoints, unitPrice, withUnitPrices } from "@/lib/prices/unitPrice";

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

describe("inUnit", () => {
  // €1 for 500 g is 0,002 €/g and €2 for 1 kg is 2 €/kg: the same price, read
  // as a thousandfold difference once the two divisions sit side by side.
  it("states every comparable record in the product's unit", () => {
    const rows = inUnit(
      [
        { id: "dozen", price: 9.6, quantity: 1, unit: "docena" },
        { id: "single", price: 0.99, quantity: 1, unit: "Unidad" },
      ],
      "unidad",
    );

    expect(rows).toEqual([
      { id: "dozen", price: 9.6, quantity: 12, unit: "unidad" },
      { id: "single", price: 0.99, quantity: 1, unit: "unidad" },
    ]);
    const [dozen, single] = withUnitPrices(rows);
    expect(dozen?.unitPrice).toBeCloseTo(0.8, 10);
    expect(single?.unitPrice).toBe(0.99);
  });

  it("leaves out a record whose unit cannot be converted", () => {
    const rows = inUnit(
      [
        { id: "grams", price: 1, quantity: 500, unit: "g" },
        { id: "kilo", price: 2, quantity: 1, unit: "kg" },
      ],
      "kg",
    );

    expect(rows.map((row) => row.id)).toEqual(["kilo"]);
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
