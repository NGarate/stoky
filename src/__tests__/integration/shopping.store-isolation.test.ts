import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import * as argon2 from "argon2";
import type { Session } from "next-auth";
import { envelope } from "../utils/test-helpers";

/**
 * Household isolation on the `storeId` a shopping item names.
 *
 * The sibling of `inventory.store-isolation.test.ts`, and it exists because
 * the defect it guards recurred. SEC-1 closed exactly this hole on
 * `inventory.addStock`; when `ShoppingItem` gained a `storeId` of its own,
 * `shopping.addItem` and `shopping.updateItem` took it from input and wrote it
 * to the row without ever asking whose store it was. The list and the product
 * were both verified against `ctx.householdId` — the store was the one that
 * was not.
 *
 * What made it worth more than a wrong foreign key: `shopping.list` and
 * `shopping.getById` include the store, so the offending household's own
 * screen then rendered another household's shop, and its response payload
 * carried that shop's name and address.
 *
 * The check now lives in one function with two callers, and this file is what
 * says so.
 */

const A = { userId: "", householdId: "", productId: "", listId: "", itemId: "" };
const B = { userId: "", householdId: "", storeId: "" };

async function callerFor(account: { userId: string; householdId: string }) {
  const session: Session = {
    user: {
      id: account.userId,
      email: `${account.userId}@example.com`,
      name: "Shop isolation",
      householdId: account.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

async function makeHousehold(label: string) {
  const household = await prisma.household.create({
    data: { name: `Shop isolation ${label}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `shop-isolation-${label}-${Date.now()}@example.com`,
      name: `Shop isolation ${label}`,
      passwordHash: await argon2.hash("TestPassword123!", {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      }),
      householdId: household.id,
      role: "OWNER",
    },
  });
  const store = await prisma.store.create({
    data: { name: `Tienda ${label}`, householdId: household.id },
  });
  return { userId: user.id, householdId: household.id, storeId: store.id };
}

let ownStoreId = "";

beforeAll(async () => {
  const a = await makeHousehold("A");
  Object.assign(A, { userId: a.userId, householdId: a.householdId });
  ownStoreId = a.storeId;
  Object.assign(B, await makeHousehold("B"));

  const product = await prisma.product.create({
    data: { name: "Leche entera", defaultUnit: "L", householdId: A.householdId },
  });
  A.productId = product.id;

  const list = await prisma.shoppingList.create({
    data: { name: "Compra del sábado", householdId: A.householdId },
  });
  A.listId = list.id;

  const item = await prisma.shoppingItem.create({
    data: { shoppingListId: list.id, productId: product.id, quantity: 1 },
  });
  A.itemId = item.id;
});

afterAll(async () => {
  const households = [A.householdId, B.householdId];
  await prisma.mutationReplay.deleteMany({
    where: { householdId: { in: households } },
  });
  await prisma.shoppingItem.deleteMany({
    where: { shoppingList: { householdId: { in: households } } },
  });
  await prisma.shoppingList.deleteMany({
    where: { householdId: { in: households } },
  });
  await prisma.product.deleteMany({
    where: { householdId: { in: households } },
  });
  await prisma.store.deleteMany({ where: { householdId: { in: households } } });
  await prisma.user.deleteMany({ where: { id: { in: [A.userId, B.userId] } } });
  await prisma.household.deleteMany({ where: { id: { in: households } } });
  await prisma.$disconnect();
});

describe("addItem and another household's store", () => {
  it("refuses a store that belongs to someone else", async () => {
    const api = await callerFor(A);

    let thrown: unknown;
    try {
      await api.shopping.addItem({
        ...envelope(A.userId),
        shoppingListId: A.listId,
        productId: A.productId,
        quantity: 1,
        storeId: B.storeId,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("NOT_FOUND");
  });

  it("writes no item at all when the store is refused", async () => {
    const api = await callerFor(A);

    const before = await prisma.shoppingItem.count({
      where: { shoppingListId: A.listId },
    });

    await api.shopping
      .addItem({
        ...envelope(A.userId),
        shoppingListId: A.listId,
        productId: A.productId,
        quantity: 2,
        storeId: B.storeId,
      })
      .catch(() => undefined);

    // The check runs before `withReplay`, so a refusal leaves neither a row
    // nor a claimed idempotency key behind — the same request retried after
    // the store is fixed must still be able to apply.
    expect(
      await prisma.shoppingItem.count({ where: { shoppingListId: A.listId } }),
    ).toBe(before);
    expect(
      await prisma.shoppingItem.count({ where: { storeId: B.storeId } }),
    ).toBe(0);
  });

  it("still accepts the household's own store", async () => {
    const api = await callerFor(A);

    const item = await api.shopping.addItem({
      ...envelope(A.userId),
      shoppingListId: A.listId,
      productId: A.productId,
      quantity: 1,
      storeId: ownStoreId,
    });

    expect(item.storeId).toBe(ownStoreId);
  });

  it("still accepts an item with no store at all", async () => {
    const api = await callerFor(A);

    const item = await api.shopping.addItem({
      ...envelope(A.userId),
      shoppingListId: A.listId,
      productId: A.productId,
      quantity: 1,
    });

    expect(item.storeId).toBeNull();
  });
});

describe("the query the row is drawn from", () => {
  it("tells the reader where to buy it", async () => {
    const api = await callerFor(A);

    await api.shopping.updateItem({
      ...envelope(A.userId),
      id: A.itemId,
      storeId: ownStoreId,
    });

    const list = await api.shopping.getById({ id: A.listId });
    const item = list.items.find((row) => row.id === A.itemId);

    // `getById` had no `store` include while `shopping.list` — which no
    // screen draws a store from — did. So a KITCHEN account, which sees the
    // read-only row, was told every item could be bought anywhere.
    expect(item?.store?.name).toBe("Tienda A");

    await api.shopping.updateItem({
      ...envelope(A.userId),
      id: A.itemId,
      storeId: null,
    });
  });
});

describe("updateItem and another household's store", () => {
  it("refuses a store that belongs to someone else", async () => {
    const api = await callerFor(A);

    let thrown: unknown;
    try {
      await api.shopping.updateItem({
        ...envelope(A.userId),
        id: A.itemId,
        storeId: B.storeId,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("NOT_FOUND");

    const item = await prisma.shoppingItem.findUnique({
      where: { id: A.itemId },
    });
    expect(item?.storeId).toBeNull();
  });

  it("still accepts the household's own store", async () => {
    const api = await callerFor(A);

    const item = await api.shopping.updateItem({
      ...envelope(A.userId),
      id: A.itemId,
      storeId: ownStoreId,
    });

    expect(item.storeId).toBe(ownStoreId);
  });

  it("still clears the store with null", async () => {
    const api = await callerFor(A);

    const item = await api.shopping.updateItem({
      ...envelope(A.userId),
      id: A.itemId,
      storeId: null,
    });

    expect(item.storeId).toBeNull();
  });

  it("still ticks an item off without naming a store", async () => {
    const api = await callerFor(A);

    const item = await api.shopping.updateItem({
      ...envelope(A.userId),
      id: A.itemId,
      isChecked: true,
    });

    expect(item.isChecked).toBe(true);
  });
});
