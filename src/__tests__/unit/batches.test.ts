import { describe, it, expect } from "bun:test";
import { Decimal } from "@prisma/client-runtime-utils";
import {
  daysUntilExpiry,
  endOfDayAfter,
  netStock as sum,
  startOfToday,
} from "@/lib/inventory/batches";

const netStock = (quantities: number[]) =>
  sum(
    quantities.map((quantity) => ({ quantity: new Decimal(quantity) })),
  ).toNumber();

describe("netStock", () => {
  it("is everything in minus everything out", () => {
    expect(netStock([6, -4, 1])).toBe(3);
  });

  it("is zero for an empty ledger", () => {
    expect(netStock([])).toBe(0);
  });

  it("adds exactly, with no binary floating point residue", () => {
    expect(netStock([0.1, 0.2])).toBe(0.3);
  });

  it("can be negative, because the ledger is what it is", () => {
    // The guards stop this being written, but a figure that silently clamps
    // would hide a corruption rather than showing it.
    expect(netStock([1, -3])).toBe(-2);
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
