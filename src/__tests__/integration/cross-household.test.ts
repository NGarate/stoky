import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import type { AppSession } from "@/lib/auth/session";
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
  const session: AppSession = {
    user: {
      id: account.userId,
      email: `${account.userId}@example.com`,
      name: "Cross household",
      householdId: account.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    expiresKind: "idle",
    sessionId: crypto.randomUUID(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

async function makeHousehold(label: string, target: typeof A): Promise<void> {
  const household = await prisma.household.create({
    data: { name: `Cross household ${label}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `cross-${label}-${Date.now()}@example.com`,
      name: `Cross ${label}`,
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
  await prisma.product.deleteMany({
    where: { householdId: { in: households } },
  });
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

  it("shopping.getById refuses another household's list", async () => {
    // The one read here that throws rather than narrowing: it is a lookup by
    // id, so a foreign id must be NOT_FOUND, not B's list and its items.
    const api = await callerFor(A);
    const error = await refusal(() => api.shopping.getById({ id: B.listId }));
    expect(error.code).toBe("NOT_FOUND");
  });
});

describe("writes never reach across households", () => {
  it("product.update refuses a foreign id and leaves the row unchanged", async () => {
    const api = await callerFor(A);
    const error = await refusal(() =>
      api.product.update({ id: B.productId, name: "Renombrado por A" }),
    );
    expect(error.code).toBe("NOT_FOUND");
    const after = await prisma.product.findUnique({
      where: { id: B.productId },
    });
    expect(after?.name).toBe("Producto secreto de B");
  });

  it("product.delete (as admin) refuses a foreign id and the product survives", async () => {
    const api = await callerFor(A);
    const error = await refusal(() => api.product.delete({ id: B.productId }));
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

  // The cases below are the ones `unit/tenant-scoped-ids.test.ts` cannot see:
  // each is guarded by a primary `id` (or, for `location.update`, by a
  // `parentId` beside a lookup it already has), and that scan only knows the
  // foreign-key-shaped fields. Removing any of these guards left every gate
  // green until they were here (docs/SECURITY_REVIEW.md §2). Each update
  // carries a real field, so the "unchanged" half has something to catch: an
  // update that changes nothing leaves B's row as it was whether or not the
  // guard held.

  it("shopping.update refuses a foreign list and leaves its name", async () => {
    const api = await callerFor(A);
    const error = await refusal(() =>
      api.shopping.update({ id: B.listId, name: "Renombrada por A" }),
    );
    expect(error.code).toBe("NOT_FOUND");
    const after = await prisma.shoppingList.findUnique({
      where: { id: B.listId },
    });
    expect(after?.name).toBe("Lista de B");
  });

  it("store.update refuses a foreign store and leaves it unchanged", async () => {
    const api = await callerFor(A);
    const error = await refusal(() =>
      api.store.update({ id: B.storeId, name: "Renombrada por A" }),
    );
    expect(error.code).toBe("NOT_FOUND");
    const after = await prisma.store.findUnique({ where: { id: B.storeId } });
    expect(after?.name).toBe("Tienda de B");
  });

  it("location.create refuses a foreign parent and creates nothing", async () => {
    const api = await callerFor(A);
    const error = await refusal(() =>
      api.location.create({ name: "Dentro de B", parentId: B.locationId }),
    );
    expect(error.code).toBe("NOT_FOUND");
    expect(
      await prisma.storageLocation.count({ where: { parentId: B.locationId } }),
    ).toBe(0);
    expect(
      await prisma.storageLocation.count({
        where: { householdId: A.householdId, name: "Dentro de B" },
      }),
    ).toBe(0);
  });

  it("location.update refuses a foreign id and leaves it unchanged", async () => {
    // Two guards stand here, the existence check and the household in the
    // write's own `where`; either alone refuses. The test is red only when
    // both are gone, which is what "the procedure is not scoped" means.
    const api = await callerFor(A);
    const error = await refusal(() =>
      api.location.update({ id: B.locationId, name: "Renombrado por A" }),
    );
    expect(error.code).toBe("NOT_FOUND");
    const after = await prisma.storageLocation.findUnique({
      where: { id: B.locationId },
    });
    expect(after?.name).toBe("Estante de B");
    expect(after?.parentId).toBeNull();
  });

  it("location.update refuses a foreign parent for an own location", async () => {
    // The move's cycle walk reads inside the caller's household, so a
    // foreign parent looks like a root to it and would pass: the parent
    // lookup is the only thing that refuses this.
    const api = await callerFor(A);
    const error = await refusal(() =>
      api.location.update({ id: A.locationId, parentId: B.locationId }),
    );
    expect(error.code).toBe("NOT_FOUND");
    const after = await prisma.storageLocation.findUnique({
      where: { id: A.locationId },
    });
    expect(after?.parentId).toBeNull();
  });

  it("location.delete refuses a foreign location and it survives", async () => {
    // An empty one. B's seeded location holds stock, so with the guard gone
    // the delete would still stop at CONFLICT — a different code, but a
    // refusal that would hide the missing household filter behind an
    // unrelated rule. An empty location is the one that would actually go.
    const empty = await prisma.storageLocation.create({
      data: { name: "Estante vacío de B", householdId: B.householdId },
    });
    const api = await callerFor(A);
    const error = await refusal(() => api.location.delete({ id: empty.id }));
    expect(error.code).toBe("NOT_FOUND");
    expect(
      await prisma.storageLocation.findUnique({ where: { id: empty.id } }),
    ).not.toBeNull();
  });
});
