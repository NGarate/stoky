import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { envelope } from "../utils/test-helpers";

/**
 * A purchase is one event told in two rows.
 *
 * `addStock` writes a `StockEntry` and, when a price and a store come with it,
 * a `PriceRecord`. They were two separate statements, so a failure between them
 * left stock recorded at no price — invisible on the inventory screen and
 * silently wrong on the price history, which exists to answer what things cost.
 *
 * The failure is injected rather than summoned. `PriceRecord` has no length,
 * precision or uniqueness constraint to violate, and its only foreign keys are
 * satisfied by the time the write runs, so there is no input that makes the
 * second statement fail on its own. Handing the procedure a client whose
 * `priceRecord.create` throws is the honest way to ask the question, and it is
 * expressible only because the client comes from the context.
 */

const OWNER = { userId: "", householdId: "", productId: "", storeId: "" };

/** A client that fails exactly where the second write happens. */
function clientThatCannotWritePrices(): PrismaClient {
  return prisma.$extends({
    query: {
      priceRecord: {
        create() {
          throw new Error("price write failed");
        },
      },
    },
    // An extended client is a superset of `PrismaClient`; the context types the
    // field as the plain one because that is what production passes.
  }) as unknown as PrismaClient;
}

async function caller(db?: PrismaClient) {
  const session: AppSession = {
    user: {
      id: OWNER.userId,
      email: "atomicity@example.com",
      name: "Atomicity",
      householdId: OWNER.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    expiresKind: "idle",
    sessionId: crypto.randomUUID(),
  };
  return appRouter.createCaller(await createTRPCContext({ session, db }));
}

const purchase = {
  quantity: 2,
  unit: "L",
  price: 1.19,
};

beforeAll(async () => {
  const household = await prisma.household.create({
    data: { name: "Atomicity household" },
  });
  const user = await prisma.user.create({
    data: {
      email: `atomicity-${Date.now()}@example.com`,
      name: "Atomicity",
      householdId: household.id,
      role: "OWNER",
    },
  });
  const store = await prisma.store.create({
    data: { name: "Mercadona", householdId: household.id },
  });
  OWNER.userId = user.id;
  OWNER.householdId = household.id;
  OWNER.storeId = store.id;
});

beforeEach(async () => {
  if (OWNER.productId) {
    await prisma.priceRecord.deleteMany({ where: { productId: OWNER.productId } });
    await prisma.stockEntry.deleteMany({ where: { productId: OWNER.productId } });
    await prisma.product.deleteMany({ where: { id: OWNER.productId } });
  }
  const product = await prisma.product.create({
    data: {
      name: "Leche entera",
      defaultUnit: "L",
      householdId: OWNER.householdId,
    },
  });
  OWNER.productId = product.id;
});

afterAll(async () => {
  await prisma.priceRecord.deleteMany({
    where: { product: { householdId: OWNER.householdId } },
  });
  await prisma.stockEntry.deleteMany({
    where: { product: { householdId: OWNER.householdId } },
  });
  await prisma.product.deleteMany({ where: { householdId: OWNER.householdId } });
  await prisma.store.deleteMany({ where: { householdId: OWNER.householdId } });
  await prisma.user.deleteMany({ where: { id: OWNER.userId } });
  await prisma.household.deleteMany({ where: { id: OWNER.householdId } });
  await prisma.$disconnect();
});

describe("addStock writes the entry and its price together", () => {
  it("leaves no stock entry behind when the price record fails", async () => {
    const api = await caller(clientThatCannotWritePrices());

    let thrown: unknown;
    try {
      await api.inventory.addStock({
      ...envelope(OWNER.userId),
        ...purchase,
        productId: OWNER.productId,
        storeId: OWNER.storeId,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    // Without the transaction the entry is already committed by the time the
    // price write fails, and the household is told it owns two litres it was
    // never charged for.
    expect(
      await prisma.stockEntry.count({ where: { productId: OWNER.productId } }),
    ).toBe(0);
    expect(
      await prisma.priceRecord.count({ where: { productId: OWNER.productId } }),
    ).toBe(0);
  });

  it("writes both when nothing fails", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      ...purchase,
      productId: OWNER.productId,
      storeId: OWNER.storeId,
    });

    expect(
      await prisma.stockEntry.count({ where: { productId: OWNER.productId } }),
    ).toBe(1);
    expect(
      await prisma.priceRecord.count({ where: { productId: OWNER.productId } }),
    ).toBe(1);
  });

  it("writes the entry alone when no price came with it", async () => {
    const api = await caller();

    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId: OWNER.productId,
      quantity: 2,
      unit: "L",

    });

    expect(
      await prisma.stockEntry.count({ where: { productId: OWNER.productId } }),
    ).toBe(1);
    expect(
      await prisma.priceRecord.count({ where: { productId: OWNER.productId } }),
    ).toBe(0);
  });

  it("is not fooled by a price with no store, or a store with no price", async () => {
    const api = await caller(clientThatCannotWritePrices());

    // Neither reaches the price write, so both succeed even against a client
    // that cannot perform it — which is what makes the first test's failure
    // attributable to the price record rather than to the injection itself.
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId: OWNER.productId,
      quantity: 1,
      unit: "L",

      price: 1.19,
    });
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId: OWNER.productId,
      quantity: 1,
      unit: "L",

      storeId: OWNER.storeId,
    });

    expect(
      await prisma.stockEntry.count({ where: { productId: OWNER.productId } }),
    ).toBe(2);
  });
});
