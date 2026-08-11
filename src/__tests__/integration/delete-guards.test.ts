import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TRPCError } from "@trpc/server";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import {
  createTestUser,
  createTestHousehold,
  createMockSession,
  generateTestEmail,
} from "../utils/test-helpers";

/**
 * ISSUES.md PROD-1 — a refused delete that says what is in the way.
 *
 * Deleting a product or a store that anything references was already refused,
 * by the database, on a foreign key. That is the right rule: cascading would
 * take the price history the price screens exist to show. What was wrong was
 * the sentence — the P2003 became BAD_REQUEST "That refers to something that
 * does not exist", which describes the opposite of what happened. Too many rows
 * refer to *this* one, not too few to that one.
 *
 * So these tests are about the code and the message rather than about whether
 * the delete happens: the behaviour is deliberately unchanged, and there is a
 * test below asserting the row survives.
 */

const HOUSEHOLD = "Delete Guard Household";

type Caller = ReturnType<typeof appRouter.createCaller>;

let caller: Caller;
let householdId: string;
let userId: string;

/** Runs `work`, returning the TRPCError it threw. */
async function refusalFrom(work: Promise<unknown>): Promise<TRPCError> {
  try {
    await work;
  } catch (error) {
    return error as TRPCError;
  }
  throw new Error("expected it to be refused");
}

beforeAll(async () => {
  const household = await createTestHousehold({ name: HOUSEHOLD });
  householdId = household.id;

  const owner = await createTestUser({
    email: generateTestEmail("delete-guard"),
    name: "Delete Guard Owner",
    householdId,
    role: "OWNER",
  });
  userId = owner.id;

  caller = appRouter.createCaller(
    await createTRPCContext({ session: createMockSession(owner) }),
  );
});

afterAll(async () => {
  await prisma.priceRecord.deleteMany({ where: { product: { householdId } } });
  await prisma.stockEntry.deleteMany({ where: { product: { householdId } } });
  await prisma.product.deleteMany({ where: { householdId } });
  await prisma.store.deleteMany({ where: { householdId } });
  await prisma.user.deleteMany({ where: { householdId } });
  await prisma.household.deleteMany({ where: { name: HOUSEHOLD } });
});

describe("deleting a product that has been used", () => {
  it("is refused as a conflict, not as a bad request", async () => {
    // The code matters beyond tidiness: the offline queue reads it. 400 is
    // permanent and 409 on a reconcilable path is a question for a person —
    // and either way, "bad request" told the caller their request was
    // malformed when it was perfectly well formed.
    const product = await prisma.product.create({
      data: { name: "Leche entera", defaultUnit: "L", householdId },
    });
    await prisma.stockEntry.create({
      data: {
        productId: product.id,
        quantity: 1,
        unit: "L",
        operationType: "PURCHASE",
        createdBy: userId,
      },
    });

    const refusal = await refusalFrom(caller.product.delete({ id: product.id }));

    expect(refusal.code).toBe("CONFLICT");
  });

  it("names what is in the way, and how much of it", async () => {
    const product = await prisma.product.create({
      data: { name: "Café molido", defaultUnit: "g", householdId },
    });
    await prisma.stockEntry.createMany({
      data: [1, 2].map(() => ({
        productId: product.id,
        quantity: 1,
        unit: "g",
        operationType: "PURCHASE" as const,
        createdBy: userId,
      })),
    });

    const refusal = await refusalFrom(caller.product.delete({ id: product.id }));

    // Without the count, "this product still has stock entries" leaves somebody
    // hunting for how much.
    expect(refusal.message).toContain("2 stock entries");
    // And it says what to do next, which is REDESIGN_PLAN §7 rule 4.
    expect(refusal.message).toMatch(/remove those first/i);
  });

  it("leaves the product where it was", async () => {
    // The behaviour is deliberately unchanged. This is a message fix, not a
    // decision about whether a used product should be deletable.
    const product = await prisma.product.create({
      data: { name: "Aceite de oliva", defaultUnit: "L", householdId },
    });
    await prisma.stockEntry.create({
      data: {
        productId: product.id,
        quantity: 1,
        unit: "L",
        operationType: "PURCHASE",
        createdBy: userId,
      },
    });

    await refusalFrom(caller.product.delete({ id: product.id }));

    expect(await prisma.product.count({ where: { id: product.id } })).toBe(1);
  });
});

describe("deleting a product nothing points at", () => {
  it("still works", async () => {
    // The guard must not have turned every delete into a refusal, which is the
    // way this kind of fix usually goes wrong.
    const product = await prisma.product.create({
      data: { name: "Sal", defaultUnit: "g", householdId },
    });

    await caller.product.delete({ id: product.id });

    expect(await prisma.product.count({ where: { id: product.id } })).toBe(0);
  });
});

describe("deleting a shop", () => {
  it("is refused while prices point at it", async () => {
    const store = await prisma.store.create({
      data: { name: "Mercadona", householdId },
    });
    const product = await prisma.product.create({
      data: { name: "Yogur", defaultUnit: "unit", householdId },
    });
    await prisma.priceRecord.create({
      data: {
        productId: product.id,
        storeId: store.id,
        price: 1.19,
        unit: "unit",
      },
    });

    const refusal = await refusalFrom(caller.store.delete({ id: store.id }));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.message).toContain("1 price records");
    // Says why the rule exists rather than only that it exists: a sighting with
    // no shop attached is not a price, it is a number.
    expect(refusal.message).toMatch(/lose their meaning/i);
  });

  it("works when nothing points at it", async () => {
    const store = await prisma.store.create({
      data: { name: "Tienda vacía", householdId },
    });

    await caller.store.delete({ id: store.id });

    expect(await prisma.store.count({ where: { id: store.id } })).toBe(0);
  });

  it("tells another household's store apart from a missing one", async () => {
    // It used to scope the delete with `where: { id, householdId }`, which
    // refuses correctly and says nothing — both cases arrived as the same
    // silence. Reading the row first makes them different answers.
    const other = await createTestHousehold({ name: `${HOUSEHOLD} Other` });
    const theirs = await prisma.store.create({
      data: { name: "Ajena", householdId: other.id },
    });

    try {
      const refusal = await refusalFrom(caller.store.delete({ id: theirs.id }));

      expect(refusal.code).toBe("NOT_FOUND");
      expect(await prisma.store.count({ where: { id: theirs.id } })).toBe(1);
    } finally {
      await prisma.store.deleteMany({ where: { householdId: other.id } });
      await prisma.household.deleteMany({ where: { id: other.id } });
    }
  });
});
