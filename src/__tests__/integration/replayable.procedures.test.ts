import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import * as argon2 from "argon2";
import type { Session } from "next-auth";

/**
 * The five writes a shop composes, each sent twice.
 *
 * `replayable.test.ts` proves the *coverage* — which procedures carry replay
 * protection — against the sources and the schemas. This proves the
 * **behaviour**, against a real database, for each of them.
 *
 * It is the test that catches a resolver spreading the envelope into a Prisma
 * `data` argument. Two of these five did exactly that before this phase:
 * `shopping.addItem` wrote `data: input` and `shopping.updateItem` wrote
 * `const { id, ...data } = input`. Merging the envelope into their schemas
 * turned both into `Unknown argument 'idempotencyKey'` at runtime, with
 * nothing for the compiler to see and no unit test that would have noticed.
 */

const OWNER = {
  userId: "",
  householdId: "",
  productId: "",
  listId: "",
  locationId: "",
};

async function caller() {
  const session: Session = {
    user: {
      id: OWNER.userId,
      email: "replayable@example.com",
      name: "Replayable",
      householdId: OWNER.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

function envelope() {
  return {
    idempotencyKey: crypto.randomUUID(),
    composedByUserId: OWNER.userId,
  };
}

beforeAll(async () => {
  const household = await prisma.household.create({
    data: { name: "Replayable household" },
  });
  const user = await prisma.user.create({
    data: {
      email: `replayable-${Date.now()}@example.com`,
      name: "Replayable",
      passwordHash: await argon2.hash("TestPassword123!", {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      }),
      householdId: household.id,
      role: "OWNER",
    },
  });
  const location = await prisma.storageLocation.create({
    data: { name: "Nevera", householdId: household.id },
  });
  OWNER.userId = user.id;
  OWNER.householdId = household.id;
  OWNER.locationId = location.id;
});

beforeEach(async () => {
  await prisma.shoppingItem.deleteMany({
    where: { shoppingList: { householdId: OWNER.householdId } },
  });
  await prisma.shoppingList.deleteMany({
    where: { householdId: OWNER.householdId },
  });
  await prisma.stockEntry.deleteMany({
    where: { product: { householdId: OWNER.householdId } },
  });
  await prisma.product.deleteMany({ where: { householdId: OWNER.householdId } });
  await prisma.mutationReplay.deleteMany({ where: { userId: OWNER.userId } });

  const product = await prisma.product.create({
    data: {
      name: "Leche entera",
      defaultUnit: "L",
      householdId: OWNER.householdId,
    },
  });
  const list = await prisma.shoppingList.create({
    data: { name: "Compra", householdId: OWNER.householdId },
  });
  OWNER.productId = product.id;
  OWNER.listId = list.id;
});

afterAll(async () => {
  await prisma.shoppingItem.deleteMany({
    where: { shoppingList: { householdId: OWNER.householdId } },
  });
  await prisma.shoppingList.deleteMany({
    where: { householdId: OWNER.householdId },
  });
  await prisma.stockEntry.deleteMany({
    where: { product: { householdId: OWNER.householdId } },
  });
  await prisma.product.deleteMany({ where: { householdId: OWNER.householdId } });
  await prisma.storageLocation.deleteMany({
    where: { householdId: OWNER.householdId },
  });
  await prisma.mutationReplay.deleteMany({ where: { userId: OWNER.userId } });
  await prisma.user.deleteMany({ where: { id: OWNER.userId } });
  await prisma.household.deleteMany({ where: { id: OWNER.householdId } });
  await prisma.$disconnect();
});

function stockEntryCount() {
  return prisma.stockEntry.count({
    where: { product: { householdId: OWNER.householdId } },
  });
}

function shoppingItemCount() {
  return prisma.shoppingItem.count({ where: { shoppingListId: OWNER.listId } });
}

describe("what /shopping shows", () => {
  it("shows a list that has just been created and has nothing in it", async () => {
    const api = await caller();
    const empty = await api.shopping.create({ name: "Recién creada" });

    const lists = await api.shopping.list({ includeCompleted: false });

    // The filter was `items: { some: { isChecked: false } }`, which also hid
    // every list with no items — so creating one made it disappear and the
    // button looked broken.
    expect(lists.map((list) => list.id)).toContain(empty.id);
  });

  it("still hides a list whose items are all ticked", async () => {
    const api = await caller();
    const item = await api.shopping.addItem({
      ...envelope(),
      shoppingListId: OWNER.listId,
      customName: "Pan",
      quantity: 1,
      unit: "unit",
    });
    await api.shopping.updateItem({
      ...envelope(),
      id: item.id,
      isChecked: true,
    });

    const lists = await api.shopping.list({ includeCompleted: false });

    expect(lists.map((list) => list.id)).not.toContain(OWNER.listId);
  });

  it("shows a list with something still to buy", async () => {
    const api = await caller();
    await api.shopping.addItem({
      ...envelope(),
      shoppingListId: OWNER.listId,
      customName: "Pan",
      quantity: 1,
      unit: "unit",
    });

    const lists = await api.shopping.list({ includeCompleted: false });

    expect(lists.map((list) => list.id)).toContain(OWNER.listId);
  });
});

describe("shopping.addItem", () => {
  it("adds one item however many times it arrives", async () => {
    const api = await caller();
    const call = {
      ...envelope(),
      shoppingListId: OWNER.listId,
      productId: OWNER.productId,
      quantity: 2,
      unit: "L",
    };

    const first = await api.shopping.addItem(call);
    const second = await api.shopping.addItem(call);

    expect(await shoppingItemCount()).toBe(1);
    expect(second.id).toBe(first.id);
  });
});

describe("shopping.updateItem", () => {
  it("ticks an item off once, and says so again on a replay", async () => {
    const api = await caller();
    const item = await api.shopping.addItem({
      ...envelope(),
      shoppingListId: OWNER.listId,
      productId: OWNER.productId,
      quantity: 1,
      unit: "L",
    });

    const call = { ...envelope(), id: item.id, isChecked: true };
    const first = await api.shopping.updateItem(call);
    const second = await api.shopping.updateItem(call);

    expect(first.isChecked).toBe(true);
    expect(second.isChecked).toBe(true);
    expect(second.checkedAt?.getTime()).toBe(first.checkedAt?.getTime());
  });
});

describe("shopping.removeItem", () => {
  it("answers the same way when the row is already gone", async () => {
    const api = await caller();
    const item = await api.shopping.addItem({
      ...envelope(),
      shoppingListId: OWNER.listId,
      productId: OWNER.productId,
      quantity: 1,
      unit: "L",
    });

    const call = { ...envelope(), id: item.id };
    expect(await api.shopping.removeItem(call)).toEqual({ success: true });

    // A second delete of a row that no longer exists would be a P2025 without
    // the replay record — a failure for work that already succeeded.
    expect(await api.shopping.removeItem(call)).toEqual({ success: true });
    expect(await shoppingItemCount()).toBe(0);
  });
});

describe("inventory.addStock", () => {
  it("records one purchase however many times it arrives", async () => {
    const api = await caller();
    const call = {
      ...envelope(),
      productId: OWNER.productId,
      quantity: 6,
      unit: "L",
      locationId: OWNER.locationId,
    };

    const first = await api.inventory.addStock(call);
    const second = await api.inventory.addStock(call);

    expect(await stockEntryCount()).toBe(1);
    expect(second.id).toBe(first.id);
  });

  it("hashes the expiry date by its instant, not by its object", async () => {
    const api = await caller();
    const key = envelope();
    const body = {
      productId: OWNER.productId,
      quantity: 1,
      unit: "L",
    };

    // Two separately-constructed Dates for the same moment. Superjson revives
    // a fresh object on every call, so anything that hashed identity rather
    // than value would treat a plain retry as a different request.
    await api.inventory.addStock({
      ...key,
      ...body,
      expirationDate: new Date("2026-12-01T00:00:00.000Z"),
    });
    await api.inventory.addStock({
      ...key,
      ...body,
      expirationDate: new Date(Date.UTC(2026, 11, 1)),
    });

    expect(await stockEntryCount()).toBe(1);
  });
});

describe("inventory.consumeStock", () => {
  it("consumes once however many times it arrives", async () => {
    const api = await caller();
    await api.inventory.addStock({
      ...envelope(),
      productId: OWNER.productId,
      quantity: 6,
      unit: "L",

    });

    const call = {
      ...envelope(),
      productId: OWNER.productId,
      quantity: 2,
      unit: "L",
    };

    await api.inventory.consumeStock(call);
    await api.inventory.consumeStock(call);

    const entries = await prisma.stockEntry.findMany({
      where: { productId: OWNER.productId },
    });
    const net = entries.reduce((sum, entry) => sum + entry.quantity, 0);

    // The whole point of the phase, in one number: a replayed consumption of
    // two litres against six leaves four, not two.
    expect(net).toBe(4);
  });

  it("does not let a replay slip past the availability guard", async () => {
    const api = await caller();
    await api.inventory.addStock({
      ...envelope(),
      productId: OWNER.productId,
      quantity: 2,
      unit: "L",

    });

    const call = {
      ...envelope(),
      productId: OWNER.productId,
      quantity: 2,
      unit: "L",
    };

    await api.inventory.consumeStock(call);
    await api.inventory.consumeStock(call);

    const entries = await prisma.stockEntry.findMany({
      where: { productId: OWNER.productId },
    });
    expect(entries.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(0);
  });
});
