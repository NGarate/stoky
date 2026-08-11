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
 * The drawdown rule is arithmetic over an array. It needs no database and no
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

  it("draws down the soonest-expiring batch first", () => {
    const urgent = entry(6, 2);
    const later = entry(6, 30);
    const drunk = entry(-6);

    const remaining = remainingByBatch([urgent, later, drunk]);

    // Someone reaching into the fridge takes the carton that has to go first.
    // Charging this to `later` instead would report 6 L as spoiling in two
    // days when in fact the urgent carton is gone.
    expect(remaining.get(urgent.id)).toBe(0);
    expect(remaining.get(later.id)).toBe(6);
  });

  it("spills over into the next batch when the first cannot cover it", () => {
    const urgent = entry(4, 2);
    const later = entry(6, 30);
    const drunk = entry(-7);

    const remaining = remainingByBatch([urgent, later, drunk]);

    expect(remaining.get(urgent.id)).toBe(0);
    expect(remaining.get(later.id)).toBe(3);
  });

  it("draws down undated batches last", () => {
    const undated = entry(5);
    const dated = entry(5, 10);
    const used = entry(-5);

    const remaining = remainingByBatch([undated, dated, used]);

    // An undated batch has no urgency, so nobody reaches for it first. Taking
    // it first would leave the dated batch looking fuller than it is, which is
    // the direction of error that matters.
    expect(remaining.get(dated.id)).toBe(0);
    expect(remaining.get(undated.id)).toBe(5);
  });

  it("does not depend on the order the database returned rows in", () => {
    const first = entry(3, 5);
    const second = entry(3, 9);
    const used = entry(-4);

    const forwards = remainingByBatch([first, second, used]);
    const backwards = remainingByBatch([used, second, first]);

    expect(backwards.get(first.id)).toBe(forwards.get(first.id));
    expect(backwards.get(second.id)).toBe(forwards.get(second.id));
    expect(forwards.get(first.id)).toBe(0);
    expect(forwards.get(second.id)).toBe(2);
  });

  it("breaks a tie on the same date by id, so the answer is stable", () => {
    const a = entry(2, 4);
    const b = entry(2, 4);
    const used = entry(-2);

    const remaining = remainingByBatch([b, a, used]);

    expect(remaining.get(a.id)).toBe(0);
    expect(remaining.get(b.id)).toBe(2);
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
