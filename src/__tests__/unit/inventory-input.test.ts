import { describe, it, expect } from "bun:test";
import {
  addStockSchema,
  adjustStockSchema,
  consumeStockSchema,
} from "@/lib/validations/inventory";

/**
 * ISSUES.md UI-3, items 1 and 2 — the inputs the stock procedures actually take.
 *
 * One `stockEntrySchema` used to serve all three, and it was wrong for all
 * three in the same two ways: it demanded an `operationType` that every handler
 * ignored in favour of its own constant, and its `quantity` was a bare
 * `z.number()` that two handlers then ran through `Math.abs`. So the server
 * accepted `-5` on `addStock` and booked `+5`.
 *
 * These are unit tests because they are properties of the schemas, and a schema
 * is the cheapest place there is to ask. The procedures' behaviour with the
 * values that get through is in the integration tier, where a database can say
 * what was written.
 */

const MOVEMENT = { productId: "p1", unit: "L" };

describe("adding stock", () => {
  it("refuses a negative quantity instead of silently flipping it", () => {
    // The defect this closes: `Math.abs` in the handler meant `-5` booked `+5`,
    // so a client could add stock by asking to remove it and nothing anywhere
    // said no.
    expect(addStockSchema.safeParse({ ...MOVEMENT, quantity: -5 }).success).toBe(
      false,
    );
  });

  it("refuses zero, which would write a row that adds nothing", () => {
    expect(addStockSchema.safeParse({ ...MOVEMENT, quantity: 0 }).success).toBe(
      false,
    );
  });

  it("accepts a fraction, because half a litre is a real purchase", () => {
    expect(addStockSchema.safeParse({ ...MOVEMENT, quantity: 0.5 }).success).toBe(
      true,
    );
  });

  it("no longer demands the field the handler ignores", () => {
    // It always wrote PURCHASE whatever it was told. A required field that
    // changes nothing is a field a caller has to guess at — and a caller who
    // guessed `CONSUME` here still got a purchase.
    expect(addStockSchema.safeParse({ ...MOVEMENT, quantity: 1 }).success).toBe(
      true,
    );
  });

  it("ignores it if an old client still sends it", () => {
    // Zod strips unknown keys rather than refusing, which is what makes this
    // safe for the offline queue: an operation composed before this change is
    // sitting in somebody's localStorage with `operationType` in it, and it
    // still replays.
    const parsed = addStockSchema.safeParse({
      ...MOVEMENT,
      quantity: 1,
      operationType: "CONSUME",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && "operationType" in parsed.data).toBe(false);
  });
});

describe("consuming stock", () => {
  it("takes a magnitude, not a signed amount", () => {
    expect(
      consumeStockSchema.safeParse({ ...MOVEMENT, quantity: -2 }).success,
    ).toBe(false);
    expect(
      consumeStockSchema.safeParse({ ...MOVEMENT, quantity: 2 }).success,
    ).toBe(true);
  });
});

describe("adjusting stock", () => {
  it("takes a signed delta, unlike the other two", () => {
    // `ReconcileDialog` sends `actual - netStock`, which is negative whenever
    // the count on the shelf is lower than the ledger — the ordinary case for a
    // reconciliation. This is why the three cannot share one schema.
    expect(
      adjustStockSchema.safeParse({
        ...MOVEMENT,
        quantity: -3,
        reason: "Recuento",
      }).success,
    ).toBe(true);
  });

  it("still refuses zero", () => {
    // An adjustment of nothing writes a row that changes no stock and carries a
    // reason for a change that did not happen.
    expect(
      adjustStockSchema.safeParse({
        ...MOVEMENT,
        quantity: 0,
        reason: "Recuento",
      }).success,
    ).toBe(false);
  });

  it("still needs a reason", () => {
    expect(
      adjustStockSchema.safeParse({ ...MOVEMENT, quantity: -3, reason: "" })
        .success,
    ).toBe(false);
  });
});
