import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import * as argon2 from "argon2";
import type { Session } from "next-auth";

/**
 * ISSUES.md INV-1, the half that guards writes.
 *
 * Consumption is recorded as a separate `StockEntry` with a negative quantity.
 * Both availability guards selected `quantity: { gt: 0 }` and summed the
 * result, so they measured *gross purchases* and ignored everything ever used.
 * Six litres bought and four drunk read as six available.
 *
 * It was latent rather than live, because `/inventory/consume` computes its own
 * limit from net stock and refuses first. But the page is not the authority —
 * the server is — and Phase 4 puts an offline replay queue in front of these
 * procedures, which is a caller that is not that page. ISSUES.md says it
 * outright: "Phase 4 must not build replay on top of this."
 *
 * These run against a real PostgreSQL because the defect is in a Prisma
 * `where` clause. A mocked client would have returned whatever the test
 * pretended, which is how it survived this long.
 */

const OWNER: { userId: string; householdId: string } = {
  userId: "",
  householdId: "",
};

let productId = "";
let shelfId = "";
let cupboardId = "";

async function caller() {
  const session: Session = {
    user: {
      id: OWNER.userId,
      email: "net-stock@example.com",
      name: "Net Stock",
      householdId: OWNER.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

/** Asserts a call was refused with a particular tRPC code. */
async function expectCode(call: Promise<unknown>, code: TRPCError["code"]) {
  let thrown: unknown;
  try {
    await call;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TRPCError);
  expect((thrown as TRPCError).code).toBe(code);
}

/** Net stock as the overview computes it — the figure the screens show. */
async function netStock(locationId?: string): Promise<number> {
  const entries = await prisma.stockEntry.findMany({
    where: { productId, ...(locationId ? { locationId } : {}) },
  });
  return entries.reduce((sum, entry) => sum + entry.quantity, 0);
}

beforeAll(async () => {
  const household = await prisma.household.create({
    data: { name: "INV-1 household" },
  });
  const user = await prisma.user.create({
    data: {
      email: `net-stock-${Date.now()}@example.com`,
      name: "Net Stock",
      passwordHash: await argon2.hash("TestPassword123!", {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      }),
      householdId: household.id,
      role: "OWNER",
    },
  });
  OWNER.userId = user.id;
  OWNER.householdId = household.id;

  const shelf = await prisma.storageLocation.create({
    data: { name: "Estante", householdId: household.id },
  });
  const cupboard = await prisma.storageLocation.create({
    data: { name: "Armario", householdId: household.id },
  });
  shelfId = shelf.id;
  cupboardId = cupboard.id;
});

beforeEach(async () => {
  if (productId) {
    await prisma.stockEntry.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
  }
  const product = await prisma.product.create({
    data: {
      name: "Leche entera",
      defaultUnit: "L",
      householdId: OWNER.householdId,
    },
  });
  productId = product.id;
});

afterAll(async () => {
  await prisma.stockEntry.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { householdId: OWNER.householdId } });
  await prisma.storageLocation.deleteMany({
    where: { householdId: OWNER.householdId },
  });
  await prisma.user.deleteMany({ where: { id: OWNER.userId } });
  await prisma.household.deleteMany({ where: { id: OWNER.householdId } });
  await prisma.$disconnect();
});

describe("consumeStock measures what is left", () => {
  it("refuses to consume more than the net, after an earlier consumption", async () => {
    const api = await caller();

    await api.inventory.addStock({ productId, quantity: 6, unit: "L", operationType: "PURCHASE" });
    await api.inventory.consumeStock({ productId, quantity: 4, unit: "L", operationType: "CONSUME" });

    expect(await netStock()).toBe(2);

    // Gross purchases are 6, net stock is 2. The guard used to read 6.
    await expectCode(
      api.inventory.consumeStock({ productId, quantity: 5, unit: "L", operationType: "CONSUME" }),
      "CONFLICT",
    );

    expect(await netStock()).toBe(2);
  });

  it("still allows a consumption the net supports", async () => {
    const api = await caller();

    await api.inventory.addStock({ productId, quantity: 6, unit: "L", operationType: "PURCHASE" });
    await api.inventory.consumeStock({ productId, quantity: 4, unit: "L", operationType: "CONSUME" });
    await api.inventory.consumeStock({ productId, quantity: 2, unit: "L", operationType: "CONSUME" });

    expect(await netStock()).toBe(0);
  });

  it("never lets stock go negative, however many times it is asked", async () => {
    const api = await caller();

    await api.inventory.addStock({ productId, quantity: 3, unit: "L", operationType: "PURCHASE" });
    await api.inventory.consumeStock({ productId, quantity: 3, unit: "L", operationType: "CONSUME" });

    await expectCode(
      api.inventory.consumeStock({ productId, quantity: 1, unit: "L", operationType: "CONSUME" }),
      "CONFLICT",
    );

    expect(await netStock()).toBe(0);
  });

  it("counts only the named location when one is named", async () => {
    const api = await caller();

    await api.inventory.addStock({
      productId,
      quantity: 5,
      unit: "L",
      locationId: shelfId,
      operationType: "PURCHASE",
    });
    await api.inventory.consumeStock({
      productId,
      quantity: 4,
      unit: "L",
      consumeFromLocationId: shelfId,
      operationType: "CONSUME",
    });

    expect(await netStock(shelfId)).toBe(1);

    await expectCode(
      api.inventory.consumeStock({
        productId,
        quantity: 2,
        unit: "L",
        consumeFromLocationId: shelfId,
        operationType: "CONSUME",
      }),
      "CONFLICT",
    );
  });
});

describe("transferStock measures what is left at the source", () => {
  it("refuses to move more than the source holds after a consumption", async () => {
    const api = await caller();

    await api.inventory.addStock({
      productId,
      quantity: 6,
      unit: "L",
      locationId: shelfId,
      operationType: "PURCHASE",
    });
    await api.inventory.consumeStock({
      productId,
      quantity: 4,
      unit: "L",
      consumeFromLocationId: shelfId,
      operationType: "CONSUME",
    });

    expect(await netStock(shelfId)).toBe(2);

    await expectCode(
      api.inventory.transferStock({
        productId,
        quantity: 5,
        unit: "L",
        fromLocationId: shelfId,
        toLocationId: cupboardId,
      }),
      "CONFLICT",
    );

    expect(await netStock(shelfId)).toBe(2);
    expect(await netStock(cupboardId)).toBe(0);
  });

  it("refuses to move the same stock out twice", async () => {
    const api = await caller();

    await api.inventory.addStock({
      productId,
      quantity: 4,
      unit: "L",
      locationId: shelfId,
      operationType: "PURCHASE",
    });
    await api.inventory.transferStock({
      productId,
      quantity: 4,
      unit: "L",
      fromLocationId: shelfId,
      toLocationId: cupboardId,
    });

    expect(await netStock(shelfId)).toBe(0);
    expect(await netStock(cupboardId)).toBe(4);

    await expectCode(
      api.inventory.transferStock({
        productId,
        quantity: 4,
        unit: "L",
        fromLocationId: shelfId,
        toLocationId: cupboardId,
      }),
      "CONFLICT",
    );

    expect(await netStock(shelfId)).toBe(0);
  });
});
