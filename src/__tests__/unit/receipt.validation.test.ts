import { describe, it, expect } from "bun:test";
import { receiptItemMatchSchema } from "@/lib/validations/receipt";

/**
 * The review-decision union refuses an empty line id on every branch.
 *
 * An empty `receiptItemId` was accepted and fell through to the
 * household-scoped lookup, which answered NOT_FOUND — harmless, but a shape
 * the schema should refuse at the edge the way `productId` already does,
 * rather than lean on the router to catch. DEFERRED.md item 7.
 */
describe("receiptItemMatchSchema", () => {
  it("refuses an empty receiptItemId on each action", () => {
    expect(() =>
      receiptItemMatchSchema.parse({
        receiptItemId: "",
        action: "MATCH",
        productId: "p1",
      }),
    ).toThrow();
    expect(() =>
      receiptItemMatchSchema.parse({
        receiptItemId: "",
        action: "CREATE",
        customName: "Lentejas",
      }),
    ).toThrow();
    expect(() =>
      receiptItemMatchSchema.parse({ receiptItemId: "", action: "SKIP" }),
    ).toThrow();
  });

  it("still accepts each action's own shape", () => {
    expect(
      receiptItemMatchSchema.parse({
        receiptItemId: "ri1",
        action: "MATCH",
        productId: "p1",
      }).action,
    ).toBe("MATCH");
    expect(
      receiptItemMatchSchema.parse({
        receiptItemId: "ri1",
        action: "CREATE",
        customName: "Lentejas",
      }).action,
    ).toBe("CREATE");
    expect(
      receiptItemMatchSchema.parse({ receiptItemId: "ri1", action: "SKIP" })
        .action,
    ).toBe("SKIP");
  });
});
