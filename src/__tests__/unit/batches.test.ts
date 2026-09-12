import { describe, it, expect } from "bun:test";
import {
  daysBetween,
  netStock,
  remainingByBatch,
  type LedgerEntry,
} from "@/lib/inventory/batches";

/**
 * ISSUES.md INV-1, the read half, at the only tier that can answer it cheaply.
 *
 * Batch provenance is arithmetic over an array. It needs no database and no
 * DOM, so it is unit-tested here in milliseconds and the integration suite is
 * left to prove one thing — that the router calls it.
 */

let counter = 0;
function entry(quantity: number, expiresInDays?: number): LedgerEntry {
  counter += 1;
  return {
    id: `entry-${String(counter).padStart(3, "0")}`,
    quantity,
    expirationDate:
      expiresInDays === undefined
        ? null
        : new Date(2026, 0, 1 + expiresInDays),
  };
}

describe("remainingByBatch", () => {
  it("leaves a batch untouched when nothing has been consumed", () => {
    const bought = entry(6, 3);

    expect(remainingByBatch([bought]).get(bought.id)).toBe(6);
  });

  it("subtracts consumption, which carries no date of its own", () => {
    const bought = entry(6, 3);
    const drunk = entry(-4);

    // The exact case ISSUES.md measured on the seeded household: 6 L bought,
    // 4 L drunk, and the old code reported 6 L about to spoil.
    expect(remainingByBatch([bought, drunk]).get(bought.id)).toBe(2);
  });

  it("reports a fully consumed batch as empty rather than omitting it", () => {
    const bought = entry(6, 3);
    const drunk = entry(-6);

    const remaining = remainingByBatch([bought, drunk]);

    expect(remaining.has(bought.id)).toBe(true);
    expect(remaining.get(bought.id)).toBe(0);
  });

  it("does not choose a batch by expiry when the source was not recorded", () => {
    const early = entry(3, 2);
    const late = entry(3, 20);
    const remaining = remainingByBatch([early, late, entry(-2)]);
    expect(remaining.get(early.id)).toBeNull();
    expect(remaining.get(late.id)).toBeNull();
  });

  it("debits the explicit batch, even when another expires sooner", () => {
    const early = entry(3, 2);
    const late = entry(3, 20);
    const used = { ...entry(-2), batchId: late.id };
    const remaining = remainingByBatch([early, late, used]);
    expect(remaining.get(early.id)).toBe(3);
    expect(remaining.get(late.id)).toBe(1);
  });

  it("does not spend a batch in another location", () => {
    const early = { ...entry(3, 2), locationId: "garage" };
    const late = { ...entry(3, 20), locationId: "fridge" };
    const used = { ...entry(-2), locationId: "fridge" };
    const remaining = remainingByBatch([early, late, used]);
    expect(remaining.get(early.id)).toBe(3);
    expect(remaining.get(late.id)).toBe(1);
  });

  it("keeps an adjustment's unknown allocation unknown", () => {
    const dated = entry(2, 2);
    const undated = entry(1);
    const remaining = remainingByBatch([dated, undated, entry(-1)]);
    expect(remaining.get(dated.id)).toBeNull();
    expect(remaining.get(undated.id)).toBeNull();
  });

  it("does not charge old consumption to a later replenishment", () => {
    const old = { ...entry(2, 2), createdAt: new Date(1) };
    const used = { ...entry(-2), createdAt: new Date(2) };
    const fresh = { ...entry(3, 20), createdAt: new Date(3) };
    const remaining = remainingByBatch([fresh, used, old]);
    expect(remaining.get(old.id)).toBe(0);
    expect(remaining.get(fresh.id)).toBe(3);
  });

  it("never reports a negative remainder, however much was consumed", () => {
    const bought = entry(2, 3);
    const drunk = entry(-9);

    expect(remainingByBatch([bought, drunk]).get(bought.id)).toBe(0);
  });

  it("does not leave a rounding crumb behind", () => {
    const bought = entry(0.3, 3);
    const used = [entry(-0.1), entry(-0.2)];

    // 0.1 + 0.2 is 0.30000000000000004, so an unrounded subtraction leaves
    // about -5.5e-17 — which is not > 0, but the positive equivalent would be,
    // and would show an empty batch as expiring.
    expect(remainingByBatch([bought, ...used]).get(bought.id)).toBe(0);
  });

  it("ignores entries that are not batches when nothing was consumed", () => {
    const bought = entry(4, 6);
    const alsoBought = entry(1, 8);

    const remaining = remainingByBatch([bought, alsoBought]);

    expect(remaining.get(bought.id)).toBe(4);
    expect(remaining.get(alsoBought.id)).toBe(1);
  });
});

describe("netStock", () => {
  it("is everything in minus everything out", () => {
    expect(netStock([entry(6, 3), entry(-4), entry(1)])).toBe(3);
  });

  it("is zero for an empty ledger", () => {
    expect(netStock([])).toBe(0);
  });

  it("rounds away binary floating point", () => {
    expect(netStock([entry(0.1), entry(0.2)])).toBe(0.3);
  });

  it("can be negative, because the ledger is what it is", () => {
    // The guards stop this being written, but a figure that silently clamps
    // would hide a corruption rather than showing it.
    expect(netStock([entry(1), entry(-3)])).toBe(-2);
  });
});

describe("daysBetween", () => {
  const noon = new Date(2026, 0, 1, 12, 0, 0);

  it("rounds a part-day up, so 'tomorrow' is 1 and not 0", () => {
    expect(daysBetween(noon, new Date(2026, 0, 2, 9, 0, 0))).toBe(1);
  });

  it("is zero for a date already reached", () => {
    expect(daysBetween(noon, noon)).toBe(0);
  });

  it("is negative once the date has passed", () => {
    expect(daysBetween(noon, new Date(2025, 11, 30, 12, 0, 0))).toBe(-2);
  });

  it("gives days-elapsed by negation, not by measuring the other way", () => {
    // A carton four days and one second gone. Measuring elapsed time directly
    // and rounding it up — which `getExpiredItems` used to do — calls that
    // five days. Negating the one measurement calls it four.
    const gone = new Date(noon.getTime() - 4 * 24 * 60 * 60 * 1000 - 1000);

    expect(-daysBetween(noon, gone)).toBe(4);
    expect(Math.ceil((noon.getTime() - gone.getTime()) / 86_400_000)).toBe(5);
  });
});
