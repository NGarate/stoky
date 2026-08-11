import { describe, it, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  addShoppingItemSchema,
  shoppingItemSchema,
} from "@/lib/validations/shopping";

/**
 * ISSUES.md SHOP-1 — an item has a name, one way or the other.
 *
 * `productId` and `customName` were plain optionals with nothing joining them,
 * so an item with *neither* was accepted. It reached the phone screen as an
 * empty row that could still be ticked: `getBuyList` computes
 * `product?.name ?? item.customName ?? ""`, and that final empty string was the
 * only thing between this and a crash.
 *
 * Unit tests because it is a property of the schema, which is the cheapest
 * place there is to ask.
 */

const LIST = { shoppingListId: "list-1", quantity: 1 };
const ENVELOPE = { idempotencyKey: randomUUID(), composedByUserId: "clttttttttttttttttttttttt" };

describe("what makes an item nameable", () => {
  it("accepts a product", () => {
    expect(shoppingItemSchema.safeParse({ ...LIST, productId: "p1" }).success).toBe(
      true,
    );
  });

  it("accepts free text, which is what a shopping list is for", () => {
    // Nobody wants to create a product record to remember to buy stamps.
    expect(
      shoppingItemSchema.safeParse({ ...LIST, customName: "Sellos" }).success,
    ).toBe(true);
  });

  it("refuses neither", () => {
    // The defect. This used to pass, and arrive on screen as a row with no name.
    expect(shoppingItemSchema.safeParse(LIST).success).toBe(false);
  });

  it("refuses a name that is only whitespace", () => {
    // A form submitting its untouched text field. Without the trim this passes
    // and the row is nameless anyway, which is the same bug wearing a space.
    expect(
      shoppingItemSchema.safeParse({ ...LIST, customName: "   " }).success,
    ).toBe(false);
  });

  it("refuses both", () => {
    // `getBuyList` shows the product's name and ignores the custom one, so an
    // item with both stores a string nobody will ever see. If naming a product
    // differently on a list is wanted, it wants a field of its own.
    expect(
      shoppingItemSchema.safeParse({
        ...LIST,
        productId: "p1",
        customName: "La grande",
      }).success,
    ).toBe(false);
  });

  it("says which field to look at", () => {
    // next-intl aside, a Zod error with no path leaves a form unable to mark
    // anything.
    const parsed = shoppingItemSchema.safeParse(LIST);

    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]?.path).toEqual([
      "customName",
    ]);
  });
});

describe("the schema the procedure actually uses", () => {
  // `.refine` produces a `ZodEffects`, which cannot be `.merge`d — so the rule
  // has to go on *after* the replay envelope. That is the kind of arrangement
  // where one of the two schemas quietly loses the rule, so both are asserted.

  it("carries the replay envelope", () => {
    expect(
      addShoppingItemSchema.safeParse({ ...LIST, ...ENVELOPE, productId: "p1" })
        .success,
    ).toBe(true);
  });

  it("still refuses a nameless item", () => {
    expect(
      addShoppingItemSchema.safeParse({ ...LIST, ...ENVELOPE }).success,
    ).toBe(false);
  });

  it("still needs the envelope", () => {
    // The other direction: the refinement must not have replaced the merge.
    expect(
      addShoppingItemSchema.safeParse({ ...LIST, productId: "p1" }).success,
    ).toBe(false);
  });
});
