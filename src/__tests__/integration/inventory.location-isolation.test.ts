import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import * as argon2 from "argon2";
import type { Session } from "next-auth";
import { envelope } from "../utils/test-helpers";

/**
 * Household isolation on the storage location, in the three stock procedures
 * that were missing it.
 *
 * `addStock` verifies the location against the household — `inventory.ts:357`,
 * and `inventory.store-isolation.test.ts` says so in as many words while
 * testing the store beside it. `consumeStock`, `adjustStock` and
 * `transferStock` take the same field from the same input and write it
 * straight onto a `StockEntry`.
 *
 * Found by the Phase 7 review. The consequence is smaller than SEC-1's — the
 * row lands in the caller's own household, because the *product* is checked —
 * but it is a reference to somebody else's `StorageLocation`, and
 * `/products/[id]` renders `entry.location?.name`. So a caller who guesses an
 * id learns what another household calls its shelves, and their own ledger
 * quietly files stock under a place that is not theirs.
 *
 * One asymmetry is the tell, and it is the same one the receipt confirm
 * procedures had: when three siblings carry a check and one does not, the one
 * that does not is a defect rather than a decision.
 */

const A = { userId: "", householdId: "", productId: "", locationId: "" };
const B = { userId: "", householdId: "", locationId: "" };

async function callerFor(account: { userId: string; householdId: string }) {
  const session: Session = {
    user: {
      id: account.userId,
      email: `${account.userId}@example.com`,
      name: "Location isolation",
      householdId: account.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

async function makeHousehold(label: string) {
  const household = await prisma.household.create({
    data: { name: `Location isolation ${label}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `loc-isolation-${label}-${Date.now()}@example.com`,
      name: `Location ${label}`,
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
    data: { name: `Estante secreto de ${label}`, householdId: household.id },
  });
  return {
    userId: user.id,
    householdId: household.id,
    locationId: location.id,
  };
}

/** Stock to consume or move, so a refusal is the only thing that can stop it. */
async function giveStock(quantity: number) {
  await prisma.stockEntry.create({
    data: {
      productId: A.productId,
      quantity,
      unit: "L",
      operationType: "PURCHASE",
      locationId: A.locationId,
      createdBy: A.userId,
    },
  });
}

beforeAll(async () => {
  Object.assign(A, await makeHousehold("A"));
  Object.assign(B, await makeHousehold("B"));

  const product = await prisma.product.create({
    data: { name: "Leche entera", defaultUnit: "L", householdId: A.householdId },
  });
  A.productId = product.id;
});

afterAll(async () => {
  const households = [A.householdId, B.householdId];
  await prisma.stockEntry.deleteMany({
    where: { product: { householdId: { in: households } } },
  });
  await prisma.product.deleteMany({ where: { householdId: { in: households } } });
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

describe("a storage location belongs to one household", () => {
  it("consumeStock refuses one that does not", async () => {
    await giveStock(5);
    const api = await callerFor(A);

    const error = await refusal(() =>
      api.inventory.consumeStock({
        ...envelope(A.userId),
        productId: A.productId,
        quantity: 1,
        unit: "L",
        consumeFromLocationId: B.locationId,
      }),
    );

    expect(error.code).toBe("NOT_FOUND");
    // Nothing filed against the stranger's shelf on the way to refusing.
    const leaked = await prisma.stockEntry.count({
      where: { locationId: B.locationId },
    });
    expect(leaked).toBe(0);
  });

  it("adjustStock refuses one that does not", async () => {
    const api = await callerFor(A);

    const error = await refusal(() =>
      api.inventory.adjustStock({
        ...envelope(A.userId),
        productId: A.productId,
        quantity: 2,
        unit: "L",
        reason: "Recuento",
        locationId: B.locationId,
      }),
    );

    expect(error.code).toBe("NOT_FOUND");
    expect(
      await prisma.stockEntry.count({ where: { locationId: B.locationId } }),
    ).toBe(0);
  });

  it("transferStock refuses one at either end", async () => {
    await giveStock(5);
    const api = await callerFor(A);

    const into = await refusal(() =>
      api.inventory.transferStock({
        ...envelope(A.userId),
        productId: A.productId,
        quantity: 1,
        unit: "L",
        fromLocationId: A.locationId,
        toLocationId: B.locationId,
      }),
    );
    expect(into.code).toBe("NOT_FOUND");

    // Both ends, because a check on one is a check somebody will assume covers
    // the other.
    const outOf = await refusal(() =>
      api.inventory.transferStock({
        ...envelope(A.userId),
        productId: A.productId,
        quantity: 1,
        unit: "L",
        fromLocationId: B.locationId,
        toLocationId: A.locationId,
      }),
    );
    expect(outOf.code).toBe("NOT_FOUND");

    expect(
      await prisma.stockEntry.count({ where: { locationId: B.locationId } }),
    ).toBe(0);
  });

  it("still allows the household's own locations", async () => {
    // A refusal that also breaks moving your own stock is not a fix.
    await giveStock(5);
    const api = await callerFor(A);

    await api.inventory.consumeStock({
      ...envelope(A.userId),
      productId: A.productId,
      quantity: 1,
      unit: "L",
      consumeFromLocationId: A.locationId,
    });

    const mine = await prisma.stockEntry.count({
      where: { locationId: A.locationId, quantity: { lt: 0 } },
    });
    expect(mine).toBeGreaterThan(0);
  });
});
