import { describe, it, expect, afterEach } from "bun:test";
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
 * ISSUES.md HOUSE-1: registration treats the household name as optional, so an
 * account can exist without one, and every household-scoped procedure then
 * refuses it.
 *
 * This covers the way out. The refusal itself — PRECONDITION_FAILED rather
 * than a bare Error — is covered in `capabilities.test.ts`, and what the
 * interface does with it is `src/__tests__/components/RouteState.test.tsx`.
 */

const HOUSEHOLD_PREFIX = "House Test";

type Caller = ReturnType<typeof appRouter.createCaller>;

async function callerForNewUser(householdId?: string): Promise<{
  caller: Caller;
  userId: string;
}> {
  const user = await createTestUser({
    email: generateTestEmail("house"),
    name: `${HOUSEHOLD_PREFIX} User`,
    householdId,
    role: householdId ? "OWNER" : "MEMBER",
  });
  const ctx = await createTRPCContext({ session: createMockSession(user) });
  return { caller: appRouter.createCaller(ctx), userId: user.id };
}

afterEach(async () => {
  const households = await prisma.household.findMany({
    where: { name: { startsWith: HOUSEHOLD_PREFIX } },
    select: { id: true },
  });
  const ids = households.map((h) => h.id);
  await prisma.user.deleteMany({ where: { name: { startsWith: HOUSEHOLD_PREFIX } } });
  if (ids.length > 0) {
    await prisma.household.deleteMany({ where: { id: { in: ids } } });
  }
});

describe("household.current", () => {
  it("returns null for an account with no household, rather than throwing", async () => {
    // The distinction the whole fix rests on: this is the one procedure an
    // account in the broken state can call, so it must not require the thing
    // that is missing.
    const { caller } = await callerForNewUser();

    const result = await caller.household.current();

    expect(result.household).toBeNull();
  });

  it("returns the household and role for an account that has one", async () => {
    const household = await createTestHousehold({ name: `${HOUSEHOLD_PREFIX} Existing` });
    const { caller } = await callerForNewUser(household.id);

    const result = await caller.household.current();

    expect(result.household?.id).toBe(household.id);
    expect(result.household?.name).toBe(`${HOUSEHOLD_PREFIX} Existing`);
    expect(result.role).toBe("OWNER");
  });
});

describe("household.create", () => {
  it("creates the household and puts the caller in it as OWNER", async () => {
    const { caller, userId } = await callerForNewUser();

    const created = await caller.household.create({ name: `${HOUSEHOLD_PREFIX} New` });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.householdId).toBe(created.id);
    expect(user?.role).toBe("OWNER");
  });

  it("unblocks the procedures that were refusing the account", async () => {
    // The end-to-end point of HOUSE-1: before, PRECONDITION_FAILED; after,
    // data. Without this the router could create a row and leave the account
    // exactly as stuck as it was.
    const { caller } = await callerForNewUser();

    await expect(caller.product.list({ limit: 20 })).rejects.toThrow();

    await caller.household.create({ name: `${HOUSEHOLD_PREFIX} Unblocked` });

    const products = await caller.product.list({ limit: 20 });
    expect(products.products).toEqual([]);
  });

  it("refuses an account that already has a household", async () => {
    const household = await createTestHousehold({ name: `${HOUSEHOLD_PREFIX} Taken` });
    const { caller } = await callerForNewUser(household.id);

    let thrown: unknown;
    try {
      await caller.household.create({ name: `${HOUSEHOLD_PREFIX} Second` });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("CONFLICT");

    // And it left nothing behind. A create that half-applies leaves a
    // household nobody is a member of, which nothing in the interface can
    // ever reach or clean up.
    expect(
      await prisma.household.count({ where: { name: `${HOUSEHOLD_PREFIX} Second` } }),
    ).toBe(0);
  });

  it("rejects an empty name", async () => {
    const { caller } = await callerForNewUser();

    await expect(caller.household.create({ name: "   " })).rejects.toThrow();
    expect(
      await prisma.household.count({ where: { name: { startsWith: HOUSEHOLD_PREFIX } } }),
    ).toBe(0);
  });

  it("refuses an unauthenticated caller", async () => {
    const ctx = await createTRPCContext({ session: null });
    const caller = appRouter.createCaller(ctx);

    let thrown: unknown;
    try {
      await caller.household.create({ name: `${HOUSEHOLD_PREFIX} Anonymous` });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("UNAUTHORIZED");
  });
});
