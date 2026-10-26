import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { HouseholdRole } from "@/generated/prisma/client";
import {
  MatchStatus,
  ReceiptStatus,
  StockOperation,
} from "@/generated/prisma/client";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import {
  createMockSession,
  createTestHousehold,
  createTestUser,
  envelope,
  generateTestEmail,
} from "../utils/test-helpers";

/**
 * The other half of the capability matrix: every restricted procedure refused
 * **by the server**, called as a role that must not have it.
 *
 * `docs/SECURITY_REVIEW.md` finding 7. There are 28 procedures on the two
 * restricted tiers and only seven were exercised behaviourally; the rest rested
 * on `unit/capabilities.test.ts`, which reads the word `writeProcedure` out of a
 * source file and calls nothing. A declaration is not a control, in the same way
 * a hidden button is not one — `integration/capabilities.test.ts` already makes
 * that argument for Journey 2's procedures, and this file finishes the matrix.
 *
 * ## Why the code alone is not enough here
 *
 * The existing suite asserts `TRPCError` with code `FORBIDDEN`. That is right
 * for the procedures it covers and **wrong for most of these**, because three
 * other places throw exactly `FORBIDDEN` for reasons that have nothing to do
 * with the role:
 *
 * - `src/server/trpc/replay.ts:145` — "This change was composed by a different
 *   account", which `shopping.removeItem` can raise;
 * - `src/server/trpc/routers/receipt.ts` at 250, 297, 341 and 388 — "Access
 *   denied" for a row belonging to another household, which all six receipt
 *   procedures can raise.
 *
 * A test that trips one of those is green with the tier guard deleted and no
 * one can tell from the code. So `expectTierRefusal` pins the guard's own
 * wording as well. That is not belt and braces: it is the difference between a
 * test and a test-shaped thing.
 *
 * ## Why the fixtures are as long as they are
 *
 * The role guard runs *before* Zod — `.input()` appends its parser to the
 * middlewares the tier already installed — so schema-invalid input **also**
 * yields FORBIDDEN today. Valid input is therefore not needed to make these
 * tests green; it is needed to make them able to go red. With the guard gone, a
 * valid call succeeds and writes something an after-check can see, while an
 * invalid one merely becomes BAD_REQUEST and the test stays green for the wrong
 * reason.
 *
 * Every fixture below exists to keep some *other* refusal out of the way:
 * NOT_FOUND for an id that is not there, CONFLICT for a row something points at,
 * CONFLICT for a transfer with an empty source, BAD_REQUEST for a receipt in the
 * wrong state. The last describe block is the proof that the effort worked —
 * the same calls, from a role that may make them, and they land.
 */

const HOUSEHOLD = "Refusal Matrix Household";
const PREFIX = "Refusal Matrix ";

type Caller = ReturnType<typeof appRouter.createCaller>;

let householdId: string;
let kitchen: Caller;
let member: Caller;
let admin: Caller;
let owner: Caller;
let kitchenUserId: string;

/** Rows the calls below aim at. Named for what makes each one safe to aim at. */
let productId: string;
let disposableProductId: string;
let storeId: string;
let spareStoreId: string;
let stockedLocationId: string;
let emptyLocationId: string;
let renameableLocationId: string;
let spareLocationId: string;
let listWithItemId: string;
let emptyListId: string;
let listItemId: string;
let reviewReceiptId: string;
let pendingItemId: string;
let secondPendingItemId: string;
let confirmedReceiptId: string;

async function callerFor(role: HouseholdRole): Promise<Caller> {
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: householdId },
  });
  const user = await createTestUser({
    email: generateTestEmail(`refusal-${role.toLowerCase()}`),
    name: `${PREFIX}${role}`,
    password: "cocina despensa nevera",
    householdId,
    role,
  });

  if (role === "KITCHEN") kitchenUserId = user.id;

  const ctx = await createTRPCContext({
    session: createMockSession({ ...user, household }),
  });
  return appRouter.createCaller(ctx);
}

/**
 * Refused by the capability middleware itself, not by a resolver's own
 * `FORBIDDEN`.
 *
 * The message is the discriminator — see the file docblock. `trpc.ts:220` and
 * `:234` are the two wordings, one per tier.
 */
async function expectTierRefusal(
  label: string,
  call: () => Promise<unknown>,
): Promise<void> {
  let thrown: unknown;
  try {
    await call();
  } catch (error) {
    thrown = error;
  }

  expect(thrown, `${label}: was not refused at all`).toBeInstanceOf(TRPCError);
  const refusal = thrown as TRPCError;
  expect(refusal.code, `${label}: refused with the wrong code`).toBe(
    "FORBIDDEN",
  );
  expect(
    refusal.message,
    `${label}: refused for the wrong reason — "${refusal.message}"`,
  ).toMatch(/may not change (household data|the household)/);
}

beforeAll(async () => {
  const household = await createTestHousehold({ name: HOUSEHOLD });
  householdId = household.id;

  kitchen = await callerFor("KITCHEN");
  member = await callerFor("MEMBER");
  admin = await callerFor("ADMIN");
  owner = await callerFor("OWNER");

  const product = await prisma.product.create({
    data: { name: `${PREFIX}Milk`, defaultUnit: "L", householdId },
  });
  productId = product.id;

  // Nothing points at this one, so `product.delete` reaches the delete rather
  // than the CONFLICT that counts references.
  const disposable = await prisma.product.create({
    data: { name: `${PREFIX}Disposable`, defaultUnit: "unit", householdId },
  });
  disposableProductId = disposable.id;

  const store = await prisma.store.create({
    data: { name: `${PREFIX}Shop`, householdId },
  });
  storeId = store.id;

  // Likewise: no prices point here, so `store.delete` can actually delete.
  const spareStore = await prisma.store.create({
    data: { name: `${PREFIX}Spare Shop`, householdId },
  });
  spareStoreId = spareStore.id;

  const stocked = await prisma.storageLocation.create({
    data: { name: `${PREFIX}Shelf`, householdId },
  });
  stockedLocationId = stocked.id;

  const empty = await prisma.storageLocation.create({
    data: { name: `${PREFIX}Cupboard`, householdId },
  });
  emptyLocationId = empty.id;

  const renameable = await prisma.storageLocation.create({
    data: { name: `${PREFIX}Rename Me`, householdId },
  });
  renameableLocationId = renameable.id;

  const spare = await prisma.storageLocation.create({
    data: { name: `${PREFIX}Spare Shelf`, householdId },
  });
  spareLocationId = spare.id;

  // `transferStock` sums what is at the source and answers CONFLICT if it is
  // short — which would refuse a red run for a reason that is not the role.
  await prisma.stockEntry.create({
    data: {
      productId,
      locationId: stockedLocationId,
      quantity: 10,
      unit: "L",
      operationType: StockOperation.PURCHASE,
      createdBy: kitchenUserId,
    },
  });

  const listWithItem = await prisma.shoppingList.create({
    data: { name: `${PREFIX}List`, householdId },
  });
  listWithItemId = listWithItem.id;

  const item = await prisma.shoppingItem.create({
    data: {
      shoppingList: { connect: { id: listWithItem.id } },
      product: { connect: { id: productId } },
      quantity: 1,
      unit: "L",
    },
  });
  listItemId = item.id;

  const emptyList = await prisma.shoppingList.create({
    data: { name: `${PREFIX}Deletable List`, householdId },
  });
  emptyListId = emptyList.id;

  // NEEDS_REVIEW with `rawOcrText`, matching what `processReceiptAsync`
  // leaves behind after OCR — the state the confirmation refusals below need.
  const reviewReceipt = await prisma.receipt.create({
    data: {
      imagePath: `uploads/receipts/${householdId}/refusal-matrix.jpg`,
      status: ReceiptStatus.NEEDS_REVIEW,
      rawOcrText: "LECHE 1,09\nTOTAL 1,09",
      householdId,
      uploadedBy: kitchenUserId,
    },
  });
  reviewReceiptId = reviewReceipt.id;

  const pending = await prisma.receiptItem.create({
    data: {
      receiptId: reviewReceipt.id,
      rawText: "LECHE 1,09",
      parsedName: "LECHE",
      parsedPrice: 1.09,
      matchedProductId: productId,
      matchStatus: MatchStatus.AUTO_MATCHED,
    },
  });
  pendingItemId = pending.id;

  // A second line, so the positive control at the end has one of its own to
  // spend rather than depending on a row an earlier test asserted about.
  const secondPending = await prisma.receiptItem.create({
    data: {
      receiptId: reviewReceipt.id,
      rawText: "PAN 0,95",
      parsedName: "PAN",
      parsedPrice: 0.95,
      matchedProductId: productId,
      matchStatus: MatchStatus.AUTO_MATCHED,
    },
  });
  secondPendingItemId = secondPending.id;

  // `applyReceipt` answers BAD_REQUEST on anything that is not CONFIRMED, so
  // this one has to be CONFIRMED for the refusal to be about the role.
  const confirmedReceipt = await prisma.receipt.create({
    data: {
      imagePath: `uploads/receipts/${householdId}/refusal-matrix-confirmed.jpg`,
      status: ReceiptStatus.CONFIRMED,
      householdId,
      uploadedBy: kitchenUserId,
      storeId,
    },
  });
  confirmedReceiptId = confirmedReceipt.id;

  await prisma.receiptItem.create({
    data: {
      receiptId: confirmedReceipt.id,
      rawText: "LECHE 1,09",
      parsedName: "LECHE",
      parsedPrice: 1.09,
      parsedQuantity: 1,
      matchedProductId: productId,
      // `USER_CONFIRMED`, not `CONFIRMED` — that is the *receipt* status, and
      // the line's enum has no such member. Written wrongly at first and the
      // tests still passed, because the value was `undefined` and Prisma fell
      // back to the column default; `tsc` is what said so.
      matchStatus: MatchStatus.USER_CONFIRMED,
    },
  });
});

afterAll(async () => {
  // Nothing cascades in this schema, so the order is the dependency order.
  await prisma.receiptItem.deleteMany({ where: { receipt: { householdId } } });
  await prisma.receipt.deleteMany({ where: { householdId } });
  await prisma.stockEntry.deleteMany({ where: { product: { householdId } } });
  await prisma.priceRecord.deleteMany({ where: { product: { householdId } } });
  await prisma.shoppingItem.deleteMany({
    where: { shoppingList: { householdId } },
  });
  await prisma.shoppingList.deleteMany({ where: { householdId } });
  await prisma.product.deleteMany({ where: { householdId } });
  await prisma.storageLocation.deleteMany({ where: { householdId } });
  await prisma.store.deleteMany({ where: { householdId } });
  // A red run may have claimed an idempotency key before failing.
  await prisma.mutationReplay.deleteMany({ where: { userId: kitchenUserId } });
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.household.deleteMany({ where: { id: householdId } });
});

describe("the household itself — admin tier", () => {
  it("refuses a kitchen account the member list and the export", async () => {
    // Neither takes input at all, so BAD_REQUEST is not even reachable here.
    await expectTierRefusal("household.members", () =>
      kitchen.household.members(),
    );
    await expectTierRefusal("data.exportHousehold", () =>
      kitchen.data.exportHousehold(),
    );
  });

  it("refuses a member the same two", async () => {
    // The whole point of the admin tier: MEMBER may change household *data* and
    // still may not read the household's own address book.
    await expectTierRefusal("household.members", () =>
      member.household.members(),
    );
    await expectTierRefusal("data.exportHousehold", () =>
      member.data.exportHousehold(),
    );
  });

  it("refuses either of them a new account, and creates none", async () => {
    const before = await prisma.user.count({ where: { householdId } });

    for (const [role, caller] of [
      ["kitchen", kitchen],
      ["member", member],
    ] as const) {
      await expectTierRefusal(`household.addMember as ${role}`, () =>
        caller.household.addMember({
          name: `${PREFIX}Should Not Exist`,
          email: generateTestEmail(`refusal-added-${role}`),
          password: "tablet despensa nevera",
          role: "KITCHEN",
        }),
      );
    }

    expect(await prisma.user.count({ where: { householdId } })).toBe(before);
  });

  it("refuses either of them the member management, and changes nobody", async () => {
    // Added with the procedures themselves, because the whole point of this
    // file is that a restricted procedure without a behavioural refusal is a
    // declaration rather than a control — and two new admin procedures with no
    // row here would reopen `SECURITY_REVIEW.md` finding 7 by exactly two.
    //
    // The target is the kitchen account: a real member of this household, so
    // the refusal cannot be the `NOT_FOUND` that a foreign id would produce.
    for (const [role, caller] of [
      ["kitchen", kitchen],
      ["member", member],
    ] as const) {
      await expectTierRefusal(`household.updateRole as ${role}`, () =>
        caller.household.updateRole({ userId: kitchenUserId, role: "ADMIN" }),
      );
      await expectTierRefusal(`household.removeMember as ${role}`, () =>
        caller.household.removeMember({ userId: kitchenUserId }),
      );
    }

    const target = await prisma.user.findUniqueOrThrow({
      where: { id: kitchenUserId },
      select: { role: true, householdId: true },
    });
    expect(target.role).toBe("KITCHEN");
    expect(target.householdId).toBe(householdId);
  });
});

describe("the household's settings — admin tier", () => {
  it("refuses a kitchen account and a member the storage locations", async () => {
    for (const [role, caller] of [
      ["kitchen", kitchen],
      ["member", member],
    ] as const) {
      // `parentId` omitted deliberately: supplying one opens three further
      // refusals in the resolver that could stand in for the role check.
      await expectTierRefusal(`location.update as ${role}`, () =>
        caller.location.update({
          id: renameableLocationId,
          name: "Should Not Rename",
        }),
      );
      await expectTierRefusal(`location.delete as ${role}`, () =>
        caller.location.delete({ id: spareLocationId }),
      );
    }

    const renameable = await prisma.storageLocation.findUnique({
      where: { id: renameableLocationId },
    });
    expect(renameable?.name).toBe(`${PREFIX}Rename Me`);
    expect(
      await prisma.storageLocation.findUnique({
        where: { id: spareLocationId },
      }),
    ).not.toBeNull();
  });

  it("refuses them the shops", async () => {
    for (const [role, caller] of [
      ["kitchen", kitchen],
      ["member", member],
    ] as const) {
      // `name` supplied rather than `{ id }` alone: an update with no fields
      // succeeds silently, so a red run would write nothing and look refused.
      await expectTierRefusal(`store.update as ${role}`, () =>
        caller.store.update({ id: storeId, name: "Should Not Rename" }),
      );
      await expectTierRefusal(`store.delete as ${role}`, () =>
        caller.store.delete({ id: spareStoreId }),
      );
    }

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    expect(store?.name).toBe(`${PREFIX}Shop`);
    expect(
      await prisma.store.findUnique({ where: { id: spareStoreId } }),
    ).not.toBeNull();
  });
});

describe("the catalogue", () => {
  it("refuses a kitchen account a rename — write tier", async () => {
    await expectTierRefusal("product.update", () =>
      kitchen.product.update({ id: productId, name: "Should Not Rename" }),
    );

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    expect(product?.name).toBe(`${PREFIX}Milk`);
  });

  it("refuses a kitchen account and a member a deletion — admin tier", async () => {
    // `product.delete` is stricter than the matrix requires, which is the safe
    // direction and the reason MEMBER is checked here and not for `update`.
    for (const [role, caller] of [
      ["kitchen", kitchen],
      ["member", member],
    ] as const) {
      await expectTierRefusal(`product.delete as ${role}`, () =>
        caller.product.delete({ id: disposableProductId }),
      );
    }

    expect(
      await prisma.product.findUnique({ where: { id: disposableProductId } }),
    ).not.toBeNull();
  });
});

describe("stock writes — write tier", () => {
  it("refuses a kitchen account an adjustment, and moves nothing", async () => {
    const before = await prisma.stockEntry.count({ where: { productId } });

    await expectTierRefusal("inventory.adjustStock", () =>
      kitchen.inventory.adjustStock({
        productId,
        quantity: 1,
        unit: "L",
        reason: "Recuento",
      }),
    );

    expect(await prisma.stockEntry.count({ where: { productId } })).toBe(
      before,
    );
  });

  it("refuses a kitchen account a transfer, and the destination stays empty", async () => {
    await expectTierRefusal("inventory.transferStock", () =>
      kitchen.inventory.transferStock({
        productId,
        quantity: 1,
        unit: "L",
        fromLocationId: stockedLocationId,
        toLocationId: emptyLocationId,
      }),
    );

    // Named precisely: a count over the whole product would still be right if
    // the stock had moved.
    expect(
      await prisma.stockEntry.count({ where: { locationId: emptyLocationId } }),
    ).toBe(0);
  });
});

describe("prices — write tier", () => {
  it("refuses a kitchen account a price, and records none", async () => {
    await expectTierRefusal("price.recordPrice", () =>
      kitchen.price.recordPrice({
        productId,
        storeId,
        price: 1.09,
        unit: "L",
        currency: "EUR",
        quantity: 1,
      }),
    );

    expect(await prisma.priceRecord.count({ where: { productId } })).toBe(0);
  });
});

describe("shopping — the far side of the D88 boundary", () => {
  it("refuses a kitchen account the list itself, though it may add to one", async () => {
    // `create` and `addItem` are `householdProcedure` on purpose: the kitchen
    // tablet is where a household notices something needs buying. Renaming,
    // emptying and deleting stay refused, and that asymmetry is the thing this
    // test pins.
    await expectTierRefusal("shopping.update", () =>
      kitchen.shopping.update({
        id: listWithItemId,
        name: "Should Not Rename",
      }),
    );
    await expectTierRefusal("shopping.delete", () =>
      kitchen.shopping.delete({ id: emptyListId }),
    );

    const list = await prisma.shoppingList.findUnique({
      where: { id: listWithItemId },
    });
    expect(list?.name).toBe(`${PREFIX}List`);
    expect(
      await prisma.shoppingList.findUnique({ where: { id: emptyListId } }),
    ).not.toBeNull();
  });

  it("refuses a kitchen account the removal, and claims no idempotency key", async () => {
    // The envelope names the kitchen account itself. Any other id and
    // `replay.ts` throws its own FORBIDDEN — same code, different reason — and
    // this test would pass with the tier guard deleted.
    const replayEnvelope = envelope(kitchenUserId);

    await expectTierRefusal("shopping.removeItem", () =>
      kitchen.shopping.removeItem({ ...replayEnvelope, id: listItemId }),
    );

    expect(
      await prisma.shoppingItem.findUnique({ where: { id: listItemId } }),
    ).not.toBeNull();
    // A refusal that had reached the replay envelope would have spent the key.
    expect(
      await prisma.mutationReplay.findFirst({
        where: { userId: kitchenUserId, key: replayEnvelope.idempotencyKey },
      }),
    ).toBeNull();
  });
});

describe("receipts — write tier", () => {
  it("refuses a kitchen account the upload", async () => {
    const before = await prisma.receipt.count({ where: { householdId } });

    // Bytes that are not an image, so a red run stops at BAD_REQUEST without
    // starting Tesseract. The 30-per-hour limiter sits past the guard, so a
    // refusal here spends no budget.
    await expectTierRefusal("receipt.upload", () =>
      kitchen.receipt.upload({
        fileBase64: Buffer.from("not an image").toString("base64"),
        mimeType: "image/png",
      }),
    );

    expect(await prisma.receipt.count({ where: { householdId } })).toBe(before);
  });

  it("refuses a kitchen account the confirmations, and changes no line", async () => {
    await expectTierRefusal("receipt.confirmItem", () =>
      kitchen.receipt.confirmItem({
        receiptItemId: pendingItemId,
        action: "SKIP",
      }),
    );
    await expectTierRefusal("receipt.confirmAll", () =>
      kitchen.receipt.confirmAll({
        receiptId: reviewReceiptId,
        items: [{ receiptItemId: pendingItemId, action: "SKIP" }],
      }),
    );

    const line = await prisma.receiptItem.findUnique({
      where: { id: pendingItemId },
    });
    expect(line?.matchStatus).toBe(MatchStatus.AUTO_MATCHED);

    const receipt = await prisma.receipt.findUnique({
      where: { id: reviewReceiptId },
    });
    expect(receipt?.status).toBe(ReceiptStatus.NEEDS_REVIEW);
  });

  it("refuses a kitchen account the application, and books no stock", async () => {
    const before = await prisma.stockEntry.count({ where: { productId } });

    await expectTierRefusal("receipt.applyReceipt", () =>
      kitchen.receipt.applyReceipt({ receiptId: confirmedReceiptId }),
    );

    expect(await prisma.stockEntry.count({ where: { productId } })).toBe(
      before,
    );
  });
});

/**
 * The block that makes every refusal above mean something.
 *
 * Because the tier guard runs before Zod, a FORBIDDEN proves only that the
 * guard fired — not that the input was valid, the row reachable, or the call
 * capable of succeeding at all. Without this, every test above would still pass
 * if the fixtures were nonsense.
 *
 * Runs last, after each refusal's after-check, because these deliberately
 * change the rows those checks read.
 */
describe("the same calls, from a role that may make them", () => {
  it("lets an admin rename a location and a shop", async () => {
    expect(
      (
        await admin.location.update({
          id: renameableLocationId,
          name: "Admin Renamed",
        })
      ).name,
    ).toBe("Admin Renamed");

    expect(
      (await admin.store.update({ id: storeId, name: "Admin Renamed" })).name,
    ).toBe("Admin Renamed");
  });

  it("lets an admin delete the spare location and the spare shop", async () => {
    await admin.location.delete({ id: spareLocationId });
    await admin.store.delete({ id: spareStoreId });

    expect(
      await prisma.storageLocation.findUnique({
        where: { id: spareLocationId },
      }),
    ).toBeNull();
    expect(
      await prisma.store.findUnique({ where: { id: spareStoreId } }),
    ).toBeNull();
  });

  it("lets a member rename a product and record a price", async () => {
    expect(
      (await member.product.update({ id: productId, name: "Member Renamed" }))
        .name,
    ).toBe("Member Renamed");

    await member.price.recordPrice({
      productId,
      storeId,
      price: 1.09,
      unit: "L",
      currency: "EUR",
      quantity: 1,
    });

    expect(await prisma.priceRecord.count({ where: { productId } })).toBe(1);
  });

  it("lets a member adjust stock and empty a shopping list", async () => {
    await member.inventory.adjustStock({
      productId,
      quantity: 1,
      unit: "L",
      reason: "Recuento",
    });

    await member.shopping.update({
      id: listWithItemId,
      name: "Member Renamed",
    });
    await member.shopping.delete({ id: emptyListId });

    expect(
      await prisma.shoppingList.findUnique({ where: { id: emptyListId } }),
    ).toBeNull();
  });

  it("lets an owner confirm a receipt line", async () => {
    // The second line, so this does not depend on a row the refusal tests
    // asserted about.
    await owner.receipt.confirmItem({
      receiptItemId: secondPendingItemId,
      action: "SKIP",
    });

    const line = await prisma.receiptItem.findUnique({
      where: { id: secondPendingItemId },
    });
    expect(line?.matchStatus).not.toBe(MatchStatus.AUTO_MATCHED);
  });
});
