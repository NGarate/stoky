import { describe, it, expect } from "bun:test";
import { Decimal } from "@prisma/client-runtime-utils";
import { runningTotals as walk } from "@/lib/inventory/stockLedger";

/**
 * Phase 8 item 5 — the stock-history chart's arithmetic.
 *
 * `getStockHistory` returns a signed ledger, newest first and cursor-paginated,
 * so a running sum computed *forwards* from a partial page would be wrong at
 * the tail. The honest derivation works backwards from the number we know is
 * true — the product's current net stock: the total after the newest entry is
 * the net itself, and each older entry's total is the one after it minus the
 * newer entry's delta. Pagination then costs precision nothing: every point
 * drawn is exact regardless of how much ledger is loaded.
 */
function entry(id: string, quantity: number, createdAt: string) {
  return {
    id,
    quantity: new Decimal(quantity),
    createdAt: new Date(createdAt),
  };
}

/** The walk, with its totals read back as numbers for the assertions. */
function runningTotals(entries: ReturnType<typeof entry>[], net: number) {
  return walk(entries, new Decimal(net)).map((point) => ({
    ...point,
    total: point.total.toNumber(),
  }));
}

describe("runningTotals", () => {
  it("walks backwards from the current net, so every point is exact", () => {
    // Ledger (newest first): +4, -1, +2. Net now: 5.
    const points = runningTotals(
      [
        entry("e3", 4, "2026-08-15"),
        entry("e2", -1, "2026-08-10"),
        entry("e1", 2, "2026-08-01"),
      ],
      5,
    );

    expect(points.map((p) => ({ id: p.id, total: p.total }))).toEqual([
      { id: "e3", total: 5 }, // after +4 → the net we know
      { id: "e2", total: 1 }, // before the +4: 5 - 4
      { id: "e1", total: 2 }, // before the -1: 1 + 1
    ]);
  });

  it("stays exact on a partial page — the tail is derived, never summed", () => {
    // Only the two newest entries of a longer ledger are loaded. Net now: 7.
    const points = runningTotals(
      [entry("e9", 3, "2026-08-15"), entry("e8", -2, "2026-08-14")],
      7,
    );

    expect(points.map((p) => p.total)).toEqual([7, 4]);
  });

  it("returns nothing for an empty ledger", () => {
    expect(runningTotals([], 3)).toEqual([]);
  });
});
