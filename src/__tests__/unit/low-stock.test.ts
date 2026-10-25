import { describe, it, expect } from "bun:test";
import {
  isLowStock,
  needsMoreOnList,
  needsRestock,
} from "@/lib/stock/low-stock";

/**
 * The two questions, and the gap between them.
 *
 * Three implementations of this existed and happened to agree. These pin the
 * agreement so the next caller inherits an answer instead of choosing one —
 * and in particular pin the case where the three could have diverged and did
 * not: a product with no minimum at all.
 */
describe("isLowStock", () => {
  it("is true below a minimum somebody set", () => {
    expect(isLowStock(1, 2)).toBe(true);
  });

  it("is false at the minimum, which is not below it", () => {
    expect(isLowStock(2, 2)).toBe(false);
  });

  it("is false above it", () => {
    expect(isLowStock(5, 2)).toBe(false);
  });

  it("is false with no minimum, even at zero", () => {
    // Nothing said what low would mean for this product. `generateFromLowStock`
    // wrote this as `stock < (minStock || 0)`, which reaches the same answer
    // by a different route — the case where the two could have parted.
    expect(isLowStock(0, null)).toBe(false);
    expect(isLowStock(3, null)).toBe(false);
  });

  it("treats a minimum of zero as a real minimum, not as absent", () => {
    expect(isLowStock(0, 0)).toBe(false);
    expect(isLowStock(-1, 0)).toBe(true);
  });
});

describe("needsRestock", () => {
  it("includes everything low", () => {
    expect(needsRestock(1, 2)).toBe(true);
  });

  it("includes what has run out with no minimum set", () => {
    // The whole reason this is a second question: without it, a product that
    // ran out and never had a minimum appears on no screen at all.
    expect(needsRestock(0, null)).toBe(true);
  });

  it("excludes what is fine", () => {
    expect(needsRestock(5, 2)).toBe(false);
    expect(needsRestock(3, null)).toBe(false);
  });

  it("is strictly broader than isLowStock, never narrower", () => {
    const cases: Array<[number, number | null]> = [
      [0, null],
      [0, 2],
      [1, 2],
      [2, 2],
      [5, 2],
      [3, null],
      [0, 0],
      [-1, 0],
    ];
    for (const [stock, min] of cases) {
      if (isLowStock(stock, min)) {
        expect(needsRestock(stock, min)).toBe(true);
      }
    }
  });
});

describe("needsMoreOnList", () => {
  it("is false once the list covers the gap", () => {
    // One left, one written down, a minimum of two. Buying more is not what
    // this product needs.
    expect(needsMoreOnList(1, 1, 2)).toBe(false);
  });

  it("is true while the two together are still short", () => {
    expect(needsMoreOnList(1, 1, 6)).toBe(true);
  });

  it("is false with no minimum, as isLowStock is", () => {
    // Nothing said what enough means, so nothing can say it is not enough.
    expect(needsMoreOnList(0, 0, null)).toBe(false);
  });

  it("is exactly isLowStock when the list holds nothing", () => {
    for (const [stock, min] of [
      [0, 2],
      [1, 2],
      [2, 2],
      [5, 2],
    ] as const) {
      expect(needsMoreOnList(stock, 0, min)).toBe(isLowStock(stock, min));
    }
  });
});
