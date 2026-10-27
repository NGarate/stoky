import { describe, it, expect } from "bun:test";
import { Decimal } from "@prisma/client-runtime-utils";
import {
  daysUntilExpiry,
  endOfDayAfter,
  startOfToday,
  type LedgerEntry,
} from "@/lib/inventory/batches";
import * as batches from "@/lib/inventory/batches";

// The helpers take and return Decimals; these cases read as plain numbers.
const remainingByBatch = (entries: readonly LedgerEntry[]) =>
  new Map(
    [...batches.remainingByBatch(entries)].map(([id, left]) => [
      id,
      left === null ? null : left.toNumber(),
    ]),
  );
const netStock = (entries: readonly LedgerEntry[]) =>
  batches.netStock(entries).toNumber();
const allocateFefo = (
  entries: readonly LedgerEntry[],
  locationId: string,
  quantity: number,
) => {
  const { parts, unassigned } = batches.allocateFefo(
    entries,
    locationId,
    new Decimal(quantity),
  );
  return {
    parts: parts.map(({ batch, quantity }) => ({
      batch,
      quantity: quantity.toNumber(),
    })),
    unassigned: unassigned.toNumber(),
  };
};

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
    quantity: new Decimal(quantity),
    expirationDate:
      expiresInDays === undefined ? null : new Date(2026, 0, 1 + expiresInDays),
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

describe("daysUntilExpiry", () => {
  // The picker's "2026-10-06", as `new Date` parses it: UTC midnight.
  const sixth = new Date("2026-10-06");
  const madrid = (iso: string) => startOfToday(new Date(iso));

  it("is zero all through the day printed on the carton, in Madrid", () => {
    // 02:00 in Madrid is 00:00 UTC — the instant the old comparison called
    // this carton expired.
    expect(daysUntilExpiry(sixth, madrid("2026-10-06T00:00:00Z"))).toBe(0);
    expect(daysUntilExpiry(sixth, madrid("2026-10-06T21:59:59Z"))).toBe(0);
  });

  it("turns negative only when Madrid's calendar reaches the next day", () => {
    // 22:00 UTC on the 6th is midnight on the 7th in Madrid (CEST).
    expect(daysUntilExpiry(sixth, madrid("2026-10-06T22:00:00Z"))).toBe(-1);
  });

  it("counts the evening before as tomorrow, not as a part-day", () => {
    expect(daysUntilExpiry(sixth, madrid("2026-10-05T21:00:00Z"))).toBe(1);
    // Late on the 4th UTC is already the 5th in Madrid.
    expect(daysUntilExpiry(sixth, madrid("2026-10-04T23:30:00Z"))).toBe(1);
  });

  it("gives days elapsed by negation", () => {
    expect(-daysUntilExpiry(sixth, madrid("2026-10-10T12:00:00Z"))).toBe(4);
  });

  it("reads an expiry carrying a time of day as the date it falls on", () => {
    expect(
      daysUntilExpiry(
        new Date("2026-10-08T15:30:00Z"),
        madrid("2026-10-06T12:00:00Z"),
      ),
    ).toBe(2);
  });
});

describe("endOfDayAfter", () => {
  it("bounds a window so its last day is included whole", () => {
    const today = startOfToday(new Date("2026-10-06T08:00:00Z"));
    expect(endOfDayAfter(today, 7).toISOString()).toBe(
      "2026-10-14T00:00:00.000Z",
    );
  });
});

describe("allocateFefo", () => {
  const at = (
    id: string,
    quantity: number,
    day: number | null,
    locationId = "shelf",
    extra: Partial<LedgerEntry> = {},
  ): LedgerEntry => ({
    id,
    quantity: new Decimal(quantity),
    expirationDate: day === null ? null : new Date(2026, 0, day),
    locationId,
    createdAt: new Date(2026, 0, 1, 0, Number(id.replace(/\D/g, "")) || 0),
    ...extra,
  });

  it("takes the soonest expiry first, undated last", () => {
    const entries = [at("b1", 3, null), at("b2", 3, 20), at("b3", 2, 10)];
    const { parts, unassigned } = allocateFefo(entries, "shelf", 6);

    expect(parts.map((part) => [part.batch.id, part.quantity])).toEqual([
      ["b3", 2],
      ["b2", 3],
      ["b1", 1],
    ]);
    expect(unassigned).toBe(0);
  });

  it("draws only on what is left, and only at the named location", () => {
    const entries = [
      at("b1", 3, 10),
      at("b2", 5, 5, "cupboard"),
      at("c1", -2, null, "shelf", { batchId: "b1" }),
    ];
    const { parts } = allocateFefo(entries, "shelf", 1);

    expect(parts.map((part) => [part.batch.id, part.quantity])).toEqual([
      ["b1", 1],
    ]);
  });

  it("leaves what it cannot place in a known batch unassigned", () => {
    // An unattributed withdrawal at a shelf with two batches makes both unknown.
    const entries = [at("b1", 2, 10), at("b2", 2, 12), at("c9", -1, null)];
    const { parts, unassigned } = allocateFefo(entries, "shelf", 2);

    expect(parts).toEqual([]);
    expect(unassigned).toBe(2);
  });
});
