import { describe, it, expect } from "bun:test";
import { usualLocationId } from "@/lib/inventory/usualLocation";

/**
 * Phase 8 item 3 — "iran donde siempre van": the add form defaults the
 * location to where this product usually goes, read from its own ledger.
 *
 * The rules worth pinning: only *incoming* stock counts (a consumption's
 * location says where something was taken from, not where it lives); the most
 * frequent location wins; a tie goes to the most recently used; and no history
 * means no guess — `undefined`, which the form renders as "no particular
 * location", exactly as before.
 */
function entry(
  locationId: string | null,
  quantity: number,
  createdAt: string,
): { locationId: string | null; quantity: number; createdAt: Date } {
  return { locationId, quantity, createdAt: new Date(createdAt) };
}

describe("usualLocationId", () => {
  it("picks the most frequent incoming location", () => {
    expect(
      usualLocationId([
        entry("nevera", 6, "2026-08-01"),
        entry("nevera", 4, "2026-08-05"),
        entry("despensa", 2, "2026-08-10"),
      ]),
    ).toBe("nevera");
  });

  it("breaks a tie towards the most recent habit", () => {
    expect(
      usualLocationId([
        entry("despensa", 1, "2026-08-01"),
        entry("nevera", 1, "2026-08-10"),
      ]),
    ).toBe("nevera");
  });

  it("ignores consumptions and entries with no location", () => {
    expect(
      usualLocationId([
        entry("nevera", -3, "2026-08-11"),
        entry("nevera", -1, "2026-08-12"),
        entry(null, 5, "2026-08-13"),
        entry("despensa", 2, "2026-08-01"),
      ]),
    ).toBe("despensa");
  });

  it("guesses nothing from no history", () => {
    expect(usualLocationId([])).toBeUndefined();
    expect(usualLocationId([entry(null, 3, "2026-08-01")])).toBeUndefined();
  });
});
