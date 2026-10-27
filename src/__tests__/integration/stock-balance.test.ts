import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/auth/session";
import { envelope } from "../utils/test-helpers";

/**
 * A batch's `remaining` is stored, kept by every movement in the transaction
 * that writes it. These hold it to the ledger it summarises: replayed from
 * the rows, each balance is the same figure, and the table refuses a row that
 * would break the shape the balances depend on.
 */

const OWNER = { userId: "", householdId: "" };
let productId = "";
let shelfId = "";
let cupboardId = "";

async function caller() {
  const session: AppSession = {
    user: {
      id: OWNER.userId,
      email: "stock-balance@example.com",
      name: "Stock Balance",
      householdId: OWNER.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    expiresKind: "idle",
    sessionId: crypto.randomUUID(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

/** A Prisma write as a real Promise: `PrismaPromise` is lazy, and `expect` will not await it. */
const written = (write: PromiseLike<unknown>) => Promise.resolve(write);

beforeAll(async () => {
  const household = await prisma.household.create({
    data: { name: "Stock balance household" },
  });
  const user = await prisma.user.create({
    data: {
      email: `stock-balance-${Date.now()}@example.com`,
      name: "Stock Balance",
      householdId: household.id,
      role: "OWNER",
    },
  });
  OWNER.userId = user.id;
  OWNER.householdId = household.id;
  shelfId = (
    await prisma.storageLocation.create({
      data: { name: "Nevera", householdId: household.id },
    })
  ).id;
  cupboardId = (
    await prisma.storageLocation.create({
      data: { name: "Despensa", householdId: household.id },
    })
  ).id;
  productId = (
    await prisma.product.create({
      data: {
        name: "Leche entera",
        defaultUnit: "L",
        householdId: household.id,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.stockEntry.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.storageLocation.deleteMany({
    where: { householdId: OWNER.householdId },
  });
  await prisma.user.deleteMany({ where: { id: OWNER.userId } });
  await prisma.household.deleteMany({ where: { id: OWNER.householdId } });
});

describe("a batch's stored balance", () => {
  it("is what its own ledger says, after every kind of movement", async () => {
    const api = await caller();
    const later = await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 4,
      unit: "L",
      expirationDate: inDays(6),
      locationId: shelfId,
    });
    await api.inventory.addStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 3,
      unit: "L",
      expirationDate: inDays(2),
      locationId: shelfId,
    });
    // Spans both batches on the shelf, soonest first.
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      quantity: 4,
      unit: "L",
    });
    await api.inventory.consumeStock({
      ...envelope(OWNER.userId),
      productId,
      batchId: later.id,
      quantity: 0.5,
      unit: "L",
    });
    await api.inventory.transferStock({
      productId,
      quantity: 1.5,
      unit: "L",
      fromLocationId: shelfId,
      toLocationId: cupboardId,
    });
    await api.inventory.adjustStock({
      productId,
      quantity: -0.25,
      unit: "L",
      reason: "Recuento",
    });
    await api.inventory.adjustStock({
      productId,
      quantity: 2,
      unit: "L",
      reason: "Recuento",
    });

    // Each batch replayed from the rows that name it.
    const batches = await prisma.$queryRaw<
      Array<{ id: string; remaining: string; replayed: string }>
    >`
      SELECT batch.id,
             batch.remaining::text AS remaining,
             (batch.quantity + COALESCE(SUM(drawn.quantity), 0))::text AS replayed
        FROM "StockEntry" batch
        LEFT JOIN "StockEntry" drawn ON drawn."batchId" = batch.id
       WHERE batch."productId" = ${productId} AND batch.quantity > 0
       GROUP BY batch.id`;
    expect(batches.length).toBeGreaterThan(3);
    for (const batch of batches) expect(batch.remaining).toBe(batch.replayed);

    // And together they are the product's stock: 7 − 4 − 0.5 − 0.25 + 2.
    const [{ balances, net }] = await prisma.$queryRaw<
      [{ balances: string; net: string }]
    >`
      SELECT SUM(remaining)::text AS balances, SUM(quantity)::text AS net
        FROM "StockEntry" WHERE "productId" = ${productId}`;
    expect(balances).toBe(net);
    expect(Number(net)).toBe(4.25);
  });
});

describe("the table", () => {
  it("refuses a withdrawal that names no batch", async () => {
    await expect(
      written(
        prisma.stockEntry.create({
          data: {
            productId,
            quantity: -1,
            unit: "L",
            operationType: "CONSUME",
            createdBy: OWNER.userId,
          },
        }),
      ),
    ).rejects.toThrow(/StockEntry_batch_balance/);
  });

  it("refuses a batch drawn below nothing", async () => {
    const batch = await prisma.stockEntry.create({
      data: {
        productId,
        quantity: 1,
        remaining: 1,
        unit: "L",
        operationType: "PURCHASE",
        createdBy: OWNER.userId,
      },
    });

    await expect(
      written(
        prisma.stockEntry.update({
          where: { id: batch.id },
          data: { remaining: { decrement: 2 } },
        }),
      ),
    ).rejects.toThrow(/StockEntry_batch_balance/);
  });

  it("refuses a batch with no balance", async () => {
    await expect(
      written(
        prisma.stockEntry.create({
          data: {
            productId,
            quantity: 1,
            unit: "L",
            operationType: "PURCHASE",
            createdBy: OWNER.userId,
          },
        }),
      ),
    ).rejects.toThrow(/StockEntry_batch_balance/);
  });
});
