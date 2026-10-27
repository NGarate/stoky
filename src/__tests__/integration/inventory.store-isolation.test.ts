import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import type { AppSession } from "@/lib/auth/session";
import { envelope } from "../utils/test-helpers";
import { num } from "../utils/amount";

/**
 * Household isolation on `inventory.addStock`'s price record.
 *
 * `addStock` optionally writes a `PriceRecord` alongside the stock entry, and
 * took `storeId` straight from input. The product and the location in the same
 * procedure were both verified against the household; the store was not, and
 * `price.recordPrice` verifies the identical write two files away. So any
 * MEMBER could attach a price record to another household's `Store`, with no
 * interface in front of it and nothing to notice.
 *
 * `REDESIGN_PLAN.md` Phase 7 item 2 names this class as the failure that would
 * be invisible in single-household testing. It is checked here rather than
 * there because Phase 4 makes this procedure replayable from a queue, and a
 * queued write is a caller that is not a page.
 */

const A = { userId: "", householdId: "", productId: "", storeId: "" };
const B = { userId: "", householdId: "", storeId: "" };

async function callerFor(account: { userId: string; householdId: string }) {
  const session: AppSession = {
    user: {
      id: account.userId,
      email: `${account.userId}@example.com`,
      name: "Isolation",
      householdId: account.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    expiresKind: "idle",
    sessionId: crypto.randomUUID(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

async function makeHousehold(label: string) {
  const household = await prisma.household.create({
    data: { name: `Isolation ${label}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `isolation-${label}-${Date.now()}@example.com`,
      name: `Isolation ${label}`,
      householdId: household.id,
      role: "OWNER",
    },
  });
  const store = await prisma.store.create({
    data: { name: `Tienda ${label}`, householdId: household.id },
  });
  return { userId: user.id, householdId: household.id, storeId: store.id };
}

beforeAll(async () => {
  Object.assign(A, await makeHousehold("A"));
  Object.assign(B, await makeHousehold("B"));

  const product = await prisma.product.create({
    data: {
      name: "Leche entera",
      defaultUnit: "L",
      householdId: A.householdId,
    },
  });
  A.productId = product.id;
});

afterAll(async () => {
  const households = [A.householdId, B.householdId];
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
  await prisma.user.deleteMany({ where: { id: { in: [A.userId, B.userId] } } });
  await prisma.household.deleteMany({ where: { id: { in: households } } });
  await prisma.$disconnect();
});

describe("addStock and another household's store", () => {
  it("refuses a store that belongs to someone else", async () => {
    const api = await callerFor(A);

    let thrown: unknown;
    try {
      await api.inventory.addStock({
        ...envelope(A.userId),
        productId: A.productId,
        quantity: 1,
        unit: "L",

        price: 1.19,
        storeId: B.storeId,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("NOT_FOUND");
  });

  it("writes nothing at all when the store is refused", async () => {
    const api = await callerFor(A);

    const before = await prisma.stockEntry.count({
      where: { productId: A.productId },
    });

    await api.inventory
      .addStock({
        ...envelope(A.userId),
        productId: A.productId,
        quantity: 3,
        unit: "L",

        price: 1.19,
        storeId: B.storeId,
      })
      .catch(() => undefined);

    // The check runs before any write, so a refusal leaves no stock entry
    // behind either — a refused purchase must not still count as stock.
    expect(
      await prisma.stockEntry.count({ where: { productId: A.productId } }),
    ).toBe(before);
    expect(
      await prisma.priceRecord.count({ where: { storeId: B.storeId } }),
    ).toBe(0);
  });

  it("still accepts the household's own store", async () => {
    const api = await callerFor(A);

    await api.inventory.addStock({
      ...envelope(A.userId),
      productId: A.productId,
      quantity: 2,
      unit: "L",

      price: 1.09,
      storeId: A.storeId,
    });

    expect(
      await prisma.priceRecord.count({ where: { storeId: A.storeId } }),
    ).toBe(1);
  });

  it("still accepts a purchase with no store at all", async () => {
    const api = await callerFor(A);

    const entry = await api.inventory.addStock({
      ...envelope(A.userId),
      productId: A.productId,
      quantity: 1,
      unit: "L",
    });

    expect(num(entry.quantity)).toBe(1);
  });
});
