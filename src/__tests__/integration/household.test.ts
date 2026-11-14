import { describe, it, expect, afterEach } from "bun:test";
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
 * The caller's household, as `household.current` reports it — including for
 * an account with none (ISSUES.md HOUSE-1), which it answers rather than
 * refuses. The refusal every household-scoped procedure gives that account
 * is covered in `capabilities.test.ts`, and what the interface does with it
 * is `src/__tests__/components/RouteState.test.tsx`.
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
  await prisma.user.deleteMany({
    where: { name: { startsWith: HOUSEHOLD_PREFIX } },
  });
  if (ids.length > 0) {
    await prisma.household.deleteMany({ where: { id: { in: ids } } });
  }
});

describe("household.current", () => {
  it("returns null for an account with no household, rather than throwing", async () => {
    // `protectedProcedure`, not `householdProcedure`: it must not require the
    // thing it reports missing.
    const { caller } = await callerForNewUser();

    const result = await caller.household.current();

    expect(result.household).toBeNull();
  });

  it("returns the household and role for an account that has one", async () => {
    const household = await createTestHousehold({
      name: `${HOUSEHOLD_PREFIX} Existing`,
    });
    const { caller } = await callerForNewUser(household.id);

    const result = await caller.household.current();

    expect(result.household?.id).toBe(household.id);
    expect(result.household?.name).toBe(`${HOUSEHOLD_PREFIX} Existing`);
    expect(result.role).toBe("OWNER");
  });
});
