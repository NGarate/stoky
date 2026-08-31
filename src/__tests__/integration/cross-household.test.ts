import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import * as argon2 from "argon2";
import type { Session } from "next-auth";
import { envelope } from "../utils/test-helpers";

/**
 * Cross-household isolation for the reads and the replayable writes the
 * 2026-08-29 review left "reported, not verified".
 *
 * The write-path tripwire (`unit/tenant-scoped-ids.test.ts`) asserts that a
 * procedure taking a scoped id *contains a lookup* for it. That is a shape
 * check, not a proof: it cannot see whether the lookup actually refuses a
 * foreign id, and it says nothing about reads, whose safety rests on a
 * `where` filter narrowing a foreign id to nothing rather than on a throw.
 * This file is the behavioural half — household A asks for household B's rows
 * by id and is told nothing exists.
 *
 * Split into two claims per procedure, because "it was not returned" and "it
 * was refused" are different and both matter: a read must come back empty, a
 * write must both refuse *and* leave B's row untouched.
 *
 * The one defect this sweep turned up — `consumeStock` guarding one location
 * id and writing another — is `ISSUES.md` SEC-2, fixed with its own test in
 * `inventory.location-isolation.test.ts`.
 */

const A = {
  userId: "",
  householdId: "",
  productId: "",
  locationId: "",
  storeId: "",
  listId: "",
  itemId: "",
};
const B = {
  userId: "",
  householdId: "",
  productId: "",
  locationId: "",
  storeId: "",
  listId: "",
  itemId: "",
};

async function callerFor(account: { userId: string; householdId: string }) {
  const session: Session = {
    user: {
      id: account.userId,
      email: `${account.userId}@example.com`,
      name: "Cross household",
      householdId: account.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

async function makeHousehold(
  label: string,
  target: typeof A,
): Promise<void> {
  const household = await prisma.household.create({
    data: { name: `Cross household ${label}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `cross-${label}-${Date.now()}@example.com`,
      name: `Cross ${label}`,
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
    data: { name: `Estante de ${label}`, householdId: household.id },
  });
  const store = await prisma.store.create({
    data: { name: `Tienda de ${label}`, householdId: household.id },
  });
  const product = await prisma.product.create({
    data: {
      name: `Producto secreto de ${label}`,
      defaultUnit: "L",
      minStock: 2,
      householdId: household.id,
    },
  });
  await prisma.stockEntry.create({
    data: {
      productId: product.id,
      quantity: 6,
      unit: "L",
      operationType: "PURCHASE",
      locationId: location.id,
      expirationDate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      createdBy: user.id,
    },
  });
  await prisma.priceRecord.create({
    data: {
      productId: product.id,
      storeId: store.id,
      price: 1.19,
      currency: "EUR",
      unit: "L",
      quantity: 1,
    },
  });
  const list = await prisma.shoppingList.create({
    data: { name: `Lista de ${label}`, householdId: household.id },
  });
  const item = await prisma.shoppingItem.create({
    data: { shoppingListId: list.id, productId: product.id, quantity: 1 },
  });

  target.userId = user.id;
  target.householdId = household.id;
  target.productId = product.id;
  target.locationId = location.id;
  target.storeId = store.id;
  target.listId = list.id;
  target.itemId = item.id;
}

beforeAll(async () => {
  await makeHousehold("A", A);
  await makeHousehold("B", B);
});

afterAll(async () => {
  const households = [A.householdId, B.householdId];
  await prisma.shoppingItem.deleteMany({
    where: { shoppingList: { householdId: { in: households } } },
  });
  await prisma.shoppingList.deleteMany({
    where: { householdId: { in: households } },
  });
  await prisma.priceRecord.deleteMany({
    where: { product: { householdId: { in: households } } },
  });
  await prisma.stockEntry.deleteMany({
    where: { product: { householdId: { in: households } } },
  });
  await prisma.product.deleteMany({ where: { householdId: { in: households } } });
  await prisma.store.deleteMany({ where: { householdId: { in: households } } });
  await prisma.storageLocation.deleteMany({
    where: { householdId: { in: households } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [A.userId, B.userId] } } });
  await prisma.household.deleteMany({ where: { id: { in: households } } });
  await prisma.$disconnect();
});

async function refusal(call: () => Promise<unknown>): Promise<TRPCError> {
  let thrown: unknown;
  try {
    await call();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TRPCError);
  return thrown as TRPCError;
}

describe("reads never reach across households", () => {
  it("getStockOverview shows nothing of another household, by product or by its location", async () => {
    const api = await callerFor(A);

    const own = await api.inventory.getStockOverview({});
    expect(own.products.every((row) => row.id !== B.productId)).toBe(true);
    expect(own.products.some((row) => row.id === A.productId)).toBe(true);

    // A foreign locationId must narrow within A's own household, never widen
    // to B's rows.
    const byForeignLocation = await api.inventory.getStockOverview({
      locationId: B.locationId,
    });
    expect(
      byForeignLocation.products.every((row) => row.id !== B.productId),
    ).toBe(true);
  });

  it("getStockHistory refuses another household's product", async () => {
    const api = await callerFor(A);
    const error = await refusal(() =>
      api.inventory.getStockHistory({ productId: B.productId }),
    );
    expect(error.code).toBe("NOT_FOUND");
  });

  it("getExpiringItems shows nothing filtered by a foreign location", async () => {
    const api = await callerFor(A);
    const rows = await api.inventory.getExpiringItems({
      days: 3650,
      locationId: B.locationId,
    });
    expect(rows.every((row) => row.productId !== B.productId)).toBe(true);
  });

  it("getExpiredItems shows nothing filtered by a foreign location", async () => {
    const api = await callerFor(A);
    const rows = await api.inventory.getExpiredItems({
      locationId: B.locationId,
    });
    expect(rows.every((row) => row.productId !== B.productId)).toBe(true);
  });

  it("price.getHistory returns empty for another household's product", async () => {
    // A read that does not throw — its isolation is the relation filter
    // through product.householdId, so a foreign id yields [] rather than a
    // refusal.
    const api = await callerFor(A);
    const history = await api.price.getHistory({
      productId: B.productId,
      days: 3650,
    });
    expect(history).toEqual([]);
  });

  it("price.getLatestPrices returns empty for another household's product", async () => {
    const api = await callerFor(A);
    const latest = await api.price.getLatestPrices({ productId: B.productId });
    expect(latest).toEqual([]);
  });
});

describe("writes never reach across households", () => {
  it("product.update refuses a foreign id and leaves the row unchanged", async () => {
    const api = await callerFor(A);
    const error = await refusal(() =>
      api.product.update({ id: B.productId, name: "Renombrado por A" }),
    );
    expect(error.code).toBe("NOT_FOUND");
    const after = await prisma.product.findUnique({ where: { id: B.productId } });
    expect(after?.name).toBe("Producto secreto de B");
  });

  it("product.delete (as admin) refuses a foreign id and the product survives", async () => {
    const api = await callerFor(A);
    const error = await refusal(() =>
      api.product.delete({ id: B.productId }),
    );
    expect(error.code).toBe("NOT_FOUND");
    expect(
      await prisma.product.findUnique({ where: { id: B.productId } }),
    ).not.toBeNull();
  });

  it("shopping.addItem refuses a foreign list and a foreign product, writing nothing", async () => {
    const api = await callerFor(A);

    const foreignList = await refusal(() =>
      api.shopping.addItem({
        ...envelope(A.userId),
        shoppingListId: B.listId,
        productId: A.productId,
      }),
    );
    expect(foreignList.code).toBe("NOT_FOUND");
    expect(
      await prisma.shoppingItem.count({ where: { shoppingListId: B.listId } }),
    ).toBe(1); // B's own seeded item only.

    const foreignProduct = await refusal(() =>
      api.shopping.addItem({
        ...envelope(A.userId),
        shoppingListId: A.listId,
        productId: B.productId,
      }),
    );
    expect(foreignProduct.code).toBe("NOT_FOUND");
    expect(
      await prisma.shoppingItem.count({
        where: { shoppingListId: A.listId, productId: B.productId },
      }),
    ).toBe(0);
  });

  it("shopping.updateItem refuses a foreign item and leaves it untouched", async () => {
    const api = await callerFor(A);
    const error = await refusal(() =>
      api.shopping.updateItem({
        ...envelope(A.userId),
        id: B.itemId,
        isChecked: true,
      }),
    );
    expect(error.code).toBe("NOT_FOUND");
    const after = await prisma.shoppingItem.findUnique({
      where: { id: B.itemId },
    });
    expect(after?.isChecked).toBe(false);
    expect(after?.checkedAt).toBeNull();
  });

  it("shopping.removeItem refuses a foreign item and it survives", async () => {
    const api = await callerFor(A);
    const error = await refusal(() =>
      api.shopping.removeItem({ ...envelope(A.userId), id: B.itemId }),
    );
    expect(error.code).toBe("NOT_FOUND");
    expect(
      await prisma.shoppingItem.findUnique({ where: { id: B.itemId } }),
    ).not.toBeNull();
  });

  it("inventory.addStock refuses a foreign product and a foreign location", async () => {
    const api = await callerFor(A);

    const foreignProduct = await refusal(() =>
      api.inventory.addStock({
        ...envelope(A.userId),
        productId: B.productId,
        quantity: 1,
        unit: "L",
      }),
    );
    expect(foreignProduct.code).toBe("NOT_FOUND");

    const foreignLocation = await refusal(() =>
      api.inventory.addStock({
        ...envelope(A.userId),
        productId: A.productId,
        quantity: 1,
        unit: "L",
        locationId: B.locationId,
      }),
    );
    expect(foreignLocation.code).toBe("NOT_FOUND");
    expect(
      await prisma.stockEntry.count({ where: { locationId: B.locationId } }),
    ).toBe(1); // B's own seeded entry only.
  });

  it("inventory.consumeStock refuses a foreign product", async () => {
    const api = await callerFor(A);
    const error = await refusal(() =>
      api.inventory.consumeStock({
        ...envelope(A.userId),
        productId: B.productId,
        quantity: 1,
        unit: "L",
      }),
    );
    expect(error.code).toBe("NOT_FOUND");
  });
});
