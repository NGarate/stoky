import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { stockTotals } from "@/lib/stock/totals";
import type { AppSession } from "@/lib/auth/session";
import { num } from "../utils/amount";

/**
 * One answer to "how much is there", wherever it is asked.
 *
 * `product.list`, `getByBarcode`, `scanBarcode` and both shopping readers
 * summed every movement in JavaScript, some rounding and some not, while the
 * stock overview rounds in SQL. A tenth bought three times is 0.3 in one and
 * 0.30000000000000004 in the other.
 */

const A = { userId: "", householdId: "", productId: "", emptyId: "" };

async function caller() {
  const session: AppSession = {
    user: {
      id: A.userId,
      email: `${A.userId}@example.com`,
      name: "Totals",
      householdId: A.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    expiresKind: "idle",
    sessionId: crypto.randomUUID(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

beforeAll(async () => {
  const household = await prisma.household.create({
    data: { name: "Totals household" },
  });
  const user = await prisma.user.create({
    data: {
      email: `totals-${Date.now()}@example.com`,
      name: "Totals",
      householdId: household.id,
      role: "OWNER",
    },
  });
  const product = await prisma.product.create({
    data: { name: "Harina", defaultUnit: "kg", householdId: household.id },
  });
  const empty = await prisma.product.create({
    data: { name: "Sal", defaultUnit: "kg", householdId: household.id },
  });
  await prisma.stockEntry.createMany({
    data: [0.1, 0.1, 0.1].map((quantity) => ({
      productId: product.id,
      quantity,
      remaining: quantity,
      unit: "kg",
      operationType: "PURCHASE" as const,
      createdBy: user.id,
    })),
  });
  Object.assign(A, {
    userId: user.id,
    householdId: household.id,
    productId: product.id,
    emptyId: empty.id,
  });
});

afterAll(async () => {
  await prisma.shoppingItem.deleteMany({
    where: { shoppingList: { householdId: A.householdId } },
  });
  await prisma.shoppingList.deleteMany({
    where: { householdId: A.householdId },
  });
  await prisma.stockEntry.deleteMany({
    where: { productId: { in: [A.productId, A.emptyId] } },
  });
  await prisma.product.deleteMany({ where: { householdId: A.householdId } });
  await prisma.user.deleteMany({ where: { id: A.userId } });
  await prisma.household.deleteMany({ where: { id: A.householdId } });
  await prisma.$disconnect();
});

describe("stockTotals", () => {
  it("sums each product's movements, rounded to the hundredth", async () => {
    const totals = await stockTotals(prisma, [A.productId, A.emptyId]);

    expect(num(totals.get(A.productId))).toBe(0.3);
    // No movement at all is nothing in stock, not a missing answer.
    expect(num(totals.get(A.emptyId))).toBe(0);
  });
});

describe("every reader agrees with the stock overview", () => {
  it("product.list and the buy list say what the overview says", async () => {
    const api = await caller();
    const list = await prisma.shoppingList.create({
      data: { name: "Compra", householdId: A.householdId },
    });
    await prisma.shoppingItem.create({
      data: { shoppingListId: list.id, productId: A.productId, quantity: 1 },
    });

    const overview = await api.inventory.getStockOverview({ limit: 100 });
    const products = await api.product.list({ limit: 100 });
    const buyList = await api.shopping.getBuyList();

    const expected = overview.products.find(
      (p) => p.id === A.productId,
    )?.totalStock;
    expect(num(expected)).toBe(0.3);
    expect(
      num(products.products.find((p) => p.id === A.productId)?.totalStock),
    ).toBe(num(expected));
    expect(num(buyList.find((i) => i.productId === A.productId)?.stock)).toBe(
      num(expected),
    );
  });
});
