import { describe, expect, it } from "bun:test";
import { Decimal } from "@prisma/client-runtime-utils";
import {
  inUnit,
  toChartPoints,
  unitPrice,
  withUnitPrices,
} from "@/lib/prices/unitPrice";

const d = (value: number) => new Decimal(value);

/** `PriceRecord.price` is a total for `quantity` units; these divide it once. */
describe("unitPrice", () => {
  it("divides the total paid by the quantity bought, exactly", () => {
    // 5.34 / 6 in floats is 0.8899999999999999.
    expect(unitPrice(d(5.34), d(6))?.toString()).toBe("0.89");
    expect(unitPrice(d(0.99), d(1))?.toString()).toBe("0.99");
  });

  it("has no answer for a quantity that is not positive", () => {
    expect(unitPrice(d(1), d(0))).toBeNull();
    expect(unitPrice(d(1), d(-2))).toBeNull();
  });
});

describe("withUnitPrices", () => {
  it("attaches the unit price and drops the rows that have none", () => {
    const rows = withUnitPrices([
      { id: "pack", price: d(5.34), quantity: d(6) },
      { id: "broken", price: d(1), quantity: d(0) },
    ]);

    expect(rows.map((row) => row.id)).toEqual(["pack"]);
    expect(rows[0]?.unitPrice.toString()).toBe("0.89");
  });
});

describe("inUnit", () => {
  // €1 for 500 g is 0,002 €/g and €2 for 1 kg is 2 €/kg: the same price, read
  // as a thousandfold difference once the two divisions sit side by side.
  it("states every comparable record in the product's unit", () => {
    const rows = inUnit(
      [
        { id: "dozen", price: d(9.6), quantity: d(1), unit: "docena" },
        { id: "single", price: d(0.99), quantity: d(1), unit: "Unidad" },
      ],
      "unidad",
    );

    expect(
      rows.map((row) => [row.id, row.quantity.toString(), row.unit]),
    ).toEqual([
      ["dozen", "12", "unidad"],
      ["single", "1", "unidad"],
    ]);
    const [dozen, single] = withUnitPrices(rows);
    expect(dozen?.unitPrice.toString()).toBe("0.8");
    expect(single?.unitPrice.toString()).toBe("0.99");
  });

  it("leaves out a record whose unit cannot be converted", () => {
    const rows = inUnit(
      [
        { id: "grams", price: d(1), quantity: d(500), unit: "g" },
        { id: "kilo", price: d(2), quantity: d(1), unit: "kg" },
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
        unitPrice: d(0.89),
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
