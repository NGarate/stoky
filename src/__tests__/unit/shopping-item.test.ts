import { describe, it, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  addShoppingItemSchema,
  shoppingItemSchema,
} from "@/lib/validations/shopping";
import { Decimal } from "@prisma/client-runtime-utils";

/**
 * An item on a list is a product and a quantity.
 *
 * SHOP-1 fixed a real defect — `productId` and `customName` were plain
 * optionals with nothing joining them, so an item with *neither* reached the
 * phone screen as an empty row that could still be ticked — and it fixed it by
 * requiring exactly one of the two. That rule is now stricter still: the
 * product is required and the free-text field is gone.
 *
 * Free text reads like the obvious kindness. It costs more than it gives: an
 * item that names nothing the household knows about cannot be priced, cannot
 * be counted against what is in the cupboard, cannot be matched to a receipt
 * line, and cannot be suppressed when it is already covered — and every one of
 * those is a feature this application has. The kindness survives where it
 * belongs: the add form creates the product inline, so writing "sellos" on a
 * list still takes one step.
 *
 * Unit tests because it is a property of the schema, which is the cheapest
 * place there is to ask.
 */

const LIST = { shoppingListId: "list-1", quantity: 1 };
const ENVELOPE = {
  idempotencyKey: randomUUID(),
  composedByUserId: "clttttttttttttttttttttttt",
};

describe("what makes an item nameable", () => {
  it("accepts a product", () => {
    expect(
      shoppingItemSchema.safeParse({ ...LIST, productId: "p1" }).success,
    ).toBe(true);
  });

  it("refuses an item with no product", () => {
    // SHOP-1's defect and its successor at once: a row that names nothing
    // was accepted, and a row that names free text is now refused too.
    expect(shoppingItemSchema.safeParse(LIST).success).toBe(false);
  });

  it("refuses an empty product id, which is not a product", () => {
    expect(
      shoppingItemSchema.safeParse({ ...LIST, productId: "" }).success,
    ).toBe(false);
  });

  it("ignores free text rather than storing it", () => {
    const parsed = shoppingItemSchema.safeParse({
      ...LIST,
      productId: "p1",
      customName: "Sellos",
    });

    // Zod strips unknown keys, so an older client still sending the field is
    // served rather than refused — and the field does not come back.
    expect(parsed.success).toBe(true);
    expect(parsed.success && "customName" in parsed.data).toBe(false);
  });

  it("refuses a quantity of zero, which asks you to buy nothing", () => {
    expect(
      shoppingItemSchema.safeParse({ ...LIST, productId: "p1", quantity: 0 })
        .success,
    ).toBe(false);
  });

  it("refuses a negative quantity", () => {
    expect(
      shoppingItemSchema.safeParse({ ...LIST, productId: "p1", quantity: -2 })
        .success,
    ).toBe(false);
  });

  it("defaults the quantity to one, because that is what a tap means", () => {
    const parsed = shoppingItemSchema.safeParse({
      shoppingListId: "list-1",
      productId: "p1",
    });

    expect(parsed.success && parsed.data.quantity).toEqual(new Decimal(1));
  });

  it("takes an optional store, and lets it be left out", () => {
    expect(
      shoppingItemSchema.safeParse({ ...LIST, productId: "p1", storeId: "s1" })
        .success,
    ).toBe(true);
    expect(
      shoppingItemSchema.safeParse({ ...LIST, productId: "p1" }).success,
    ).toBe(true);
  });

  it("applies the same rule with the replay envelope on", () => {
    // The envelope is merged after the fields, and a rule attached to the
    // wrong one of the two schemas is a rule the queue does not apply.
    expect(
      addShoppingItemSchema.safeParse({ ...LIST, ...ENVELOPE }).success,
    ).toBe(false);
    expect(
      addShoppingItemSchema.safeParse({ ...LIST, ...ENVELOPE, productId: "p1" })
        .success,
    ).toBe(true);
  });
});
