import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import * as argon2 from "argon2";
import type { Session } from "next-auth";
import { envelope } from "../utils/test-helpers";

/**
 * A row that vanished, reported as a missing row rather than a server fault.
 *
 * This was cosmetic before Phase 4 and is not now. The offline queue reads the
 * HTTP status to decide what to do next: a 500 means "transient", so a
 * tick-off whose row somebody else deleted would be retried eight times over
 * rising backoff and then reported as exhausted — wrongly, since it was never
 * going to work. `NOT_FOUND` ends it on the first attempt.
 *
 * Against a real database, because the whole question is which error Prisma
 * raises. A mock would raise whatever the test decided to pretend.
 */

const OWNER = { userId: "", householdId: "", listId: "", productId: "" };

async function caller() {
  const session: Session = {
    user: {
      id: OWNER.userId,
      email: "prisma-errors@example.com",
      name: "Prisma Errors",
      householdId: OWNER.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  return appRouter.createCaller(await createTRPCContext({ session }));
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return "no error";
  } catch (error) {
    if (error instanceof TRPCError) return error.code;
    return `not a TRPCError: ${String(error)}`;
  }
}

beforeAll(async () => {
  const household = await prisma.household.create({
    data: { name: "Prisma errors household" },
  });
  const user = await prisma.user.create({
    data: {
      email: `prisma-errors-${Date.now()}@example.com`,
      name: "Prisma Errors",
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
});

beforeEach(async () => {
  await prisma.shoppingItem.deleteMany({
    where: { shoppingList: { householdId: OWNER.householdId } },
  });
  await prisma.shoppingList.deleteMany({
    where: { householdId: OWNER.householdId },
  });
  await prisma.product.deleteMany({ where: { householdId: OWNER.householdId } });
  await prisma.mutationReplay.deleteMany({ where: { userId: OWNER.userId } });

  const list = await prisma.shoppingList.create({
    data: { name: "Compra", householdId: OWNER.householdId },
  });
  const product = await prisma.product.create({
    data: {
      name: "Leche entera",
      defaultUnit: "L",
      householdId: OWNER.householdId,
    },
  });
  OWNER.listId = list.id;
  OWNER.productId = product.id;
});

afterAll(async () => {
  await prisma.shoppingItem.deleteMany({
    where: { shoppingList: { householdId: OWNER.householdId } },
  });
  await prisma.shoppingList.deleteMany({
    where: { householdId: OWNER.householdId },
  });
  await prisma.product.deleteMany({ where: { householdId: OWNER.householdId } });
  await prisma.mutationReplay.deleteMany({ where: { userId: OWNER.userId } });
  await prisma.user.deleteMany({ where: { id: OWNER.userId } });
  await prisma.household.deleteMany({ where: { id: OWNER.householdId } });
  await prisma.$disconnect();
});

describe("a row that is no longer there", () => {
  it("reports a deleted shopping item as missing, not as a server fault", async () => {
    const api = await caller();
    const item = await api.shopping.addItem({
      ...envelope(OWNER.userId),
      shoppingListId: OWNER.listId,
      customName: "Pan",
      quantity: 1,
      unit: "unit",
    });

    // Somebody else removes it while this device is offline.
    await prisma.shoppingItem.delete({ where: { id: item.id } });

    // Before this, Prisma's P2025 surfaced as INTERNAL_SERVER_ERROR and the
    // queue spent eight attempts on it.
    expect(
      await codeOf(
        api.shopping.updateItem({
          ...envelope(OWNER.userId),
          id: item.id,
          isChecked: true,
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("reports a deleted item's removal as missing too", async () => {
    const api = await caller();
    const item = await api.shopping.addItem({
      ...envelope(OWNER.userId),
      shoppingListId: OWNER.listId,
      customName: "Pan",
      quantity: 1,
      unit: "unit",
    });
    await prisma.shoppingItem.delete({ where: { id: item.id } });

    expect(
      await codeOf(
        api.shopping.removeItem({ ...envelope(OWNER.userId), id: item.id }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("reports a deleted list as missing when it is updated", async () => {
    const api = await caller();
    const list = await api.shopping.create({ name: "Temporal" });
    await prisma.shoppingList.delete({ where: { id: list.id } });

    expect(
      await codeOf(api.shopping.update({ id: list.id, name: "Otro" })),
    ).toBe("NOT_FOUND");
  });

  it("reports a deleted product as missing when it is updated", async () => {
    const api = await caller();
    await prisma.product.delete({ where: { id: OWNER.productId } });

    expect(
      await codeOf(
        api.product.update({ id: OWNER.productId, name: "Otra leche" }),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("a collision the database noticed", () => {
  it("reports a duplicate barcode as a conflict, not as a server fault", async () => {
    const api = await caller();
    await api.product.create({
      name: "Leche desnatada",
      defaultUnit: "L",
      barcode: "8410000000001",
    });

    // `@@unique([barcode, householdId])`. The router has no pre-check for
    // this, so it is Prisma that notices.
    expect(
      await codeOf(
        api.product.create({
          name: "Otra leche",
          defaultUnit: "L",
          barcode: "8410000000001",
        }),
      ),
    ).toBe("CONFLICT");
  });
});

describe("what is not translated", () => {
  it("leaves a router's own refusal exactly as it was", async () => {
    const api = await caller();

    // The routers decide this one themselves (DEBT-4), and the middleware must
    // not reach past a decision that has already been made.
    expect(
      await codeOf(api.shopping.getById({ id: "does-not-exist" })),
    ).toBe("NOT_FOUND");

    expect(
      await codeOf(
        api.inventory.consumeStock({
          ...envelope(OWNER.userId),
          productId: OWNER.productId,
          quantity: 99,
          unit: "L",
          operationType: "CONSUME",
        }),
      ),
    ).toBe("CONFLICT");
  });

  it("still lets a genuine fault be a fault", async () => {
    const api = await caller();

    // A validation failure is neither Prisma's nor the router's opinion.
    expect(
      await codeOf(api.shopping.create({ name: "" })),
    ).toBe("BAD_REQUEST");
  });
});
