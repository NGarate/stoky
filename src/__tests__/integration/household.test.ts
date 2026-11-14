import { describe, it, expect, afterEach } from "bun:test";
import type { HouseholdRole } from "@/generated/prisma/client";
import { MAX_NAME_LENGTH } from "@/lib/validations/bounds";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import { signInWith } from "../utils/authorize";
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
 *
 * And what removing a member leaves behind: nothing of theirs. An
 * installation holds one household, so a removed member's account is
 * deleted rather than left with no household and no way out. That removal
 * signs them out everywhere is `household.members.test.ts`'s.
 */

const HOUSEHOLD_PREFIX = "House Test";

type Caller = ReturnType<typeof appRouter.createCaller>;

async function callerForNewUser(
  householdId?: string,
  role: HouseholdRole = householdId ? "OWNER" : "MEMBER",
): Promise<{
  caller: Caller;
  userId: string;
}> {
  const user = await createTestUser({
    email: generateTestEmail("house"),
    name: `${HOUSEHOLD_PREFIX} User`,
    householdId,
    role,
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

describe("household.update", () => {
  /** Two households, so a rename has a neighbour it must not reach. */
  async function twoHouseholds() {
    const mine = await createTestHousehold({
      name: `${HOUSEHOLD_PREFIX} Mine`,
    });
    const other = await createTestHousehold({
      name: `${HOUSEHOLD_PREFIX} Other`,
    });
    return { mine, other };
  }

  const nameOf = async (id: string) =>
    (await prisma.household.findUniqueOrThrow({ where: { id } })).name;

  it("lets an admin rename their own household, and no other", async () => {
    const { mine, other } = await twoHouseholds();
    const { caller } = await callerForNewUser(mine.id, "ADMIN");

    const renamed = await caller.household.update({
      name: `  ${HOUSEHOLD_PREFIX} Renamed  `,
    });

    expect(renamed).toEqual({
      id: mine.id,
      name: `${HOUSEHOLD_PREFIX} Renamed`,
    });
    expect(await nameOf(mine.id)).toBe(`${HOUSEHOLD_PREFIX} Renamed`);
    expect(await nameOf(other.id)).toBe(`${HOUSEHOLD_PREFIX} Other`);
  });

  it.each(["MEMBER", "KITCHEN"] as const)(
    "refuses a %s account, and renames nothing",
    async (role) => {
      const { mine } = await twoHouseholds();
      const { caller } = await callerForNewUser(mine.id, role);

      await expect(
        caller.household.update({ name: `${HOUSEHOLD_PREFIX} Not Allowed` }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await nameOf(mine.id)).toBe(`${HOUSEHOLD_PREFIX} Mine`);
    },
  );

  it.each([
    ["a blank", "   "],
    ["an over-long", "x".repeat(MAX_NAME_LENGTH + 1)],
  ])("refuses %s name, and renames nothing", async (_, name) => {
    const { mine } = await twoHouseholds();
    const { caller } = await callerForNewUser(mine.id, "ADMIN");

    await expect(caller.household.update({ name })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await nameOf(mine.id)).toBe(`${HOUSEHOLD_PREFIX} Mine`);
  });
});

describe("household.removeMember", () => {
  const PASSWORD = "TestPassword123!";

  async function householdWithMember() {
    const household = await createTestHousehold({
      name: `${HOUSEHOLD_PREFIX} Removal`,
    });
    const owner = await callerForNewUser(household.id);
    const member = await createTestUser({
      email: generateTestEmail("house-removed"),
      name: `${HOUSEHOLD_PREFIX} Removed`,
      householdId: household.id,
      role: "MEMBER",
    });
    return { household, owner, member };
  }

  it("deletes the account, its credentials and its own rows, and nobody else's", async () => {
    const { household, owner, member } = await householdWithMember();
    // The control: the password works before, so the refusal after is the
    // removal's doing.
    expect(
      (await signInWith({ email: member.email, password: PASSWORD })).status,
    ).toBe(200);
    await prisma.screenChoice.createMany({
      data: [
        { userId: member.id, deviceId: crypto.randomUUID(), screen: "KITCHEN" },
        {
          userId: owner.userId,
          deviceId: crypto.randomUUID(),
          screen: "SHOPPING",
        },
      ],
    });
    await prisma.mutationReplay.create({
      data: {
        key: crypto.randomUUID(),
        userId: member.id,
        householdId: household.id,
        procedure: "test.removal",
        requestHash: "removed",
        resultIds: [],
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });

    await owner.caller.household.removeMember({ userId: member.id });

    expect(
      await prisma.user.findUnique({ where: { id: member.id } }),
    ).toBeNull();
    expect(await prisma.account.count({ where: { userId: member.id } })).toBe(
      0,
    );
    expect(await prisma.session.count({ where: { userId: member.id } })).toBe(
      0,
    );
    expect(
      await prisma.screenChoice.count({ where: { userId: member.id } }),
    ).toBe(0);
    expect(
      await prisma.mutationReplay.count({ where: { userId: member.id } }),
    ).toBe(0);
    expect(
      (await signInWith({ email: member.email, password: PASSWORD })).status,
    ).toBe(401);
    // The owner's own row is untouched.
    expect(
      await prisma.screenChoice.count({ where: { userId: owner.userId } }),
    ).toBe(1);
    await prisma.screenChoice.deleteMany({ where: { userId: owner.userId } });
  });

  it("lets the same address be added again, as a new account", async () => {
    // The way back for somebody removed by mistake: an address left on a
    // householdless row would have been refused as taken.
    const { household, owner, member } = await householdWithMember();

    await owner.caller.household.removeMember({ userId: member.id });
    const again = await owner.caller.household.addMember({
      name: `${HOUSEHOLD_PREFIX} Back`,
      email: member.email,
      password: "otra contraseña de vuelta",
      role: "MEMBER",
    });

    expect(again.id).not.toBe(member.id);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: again.id } }))
        .householdId,
    ).toBe(household.id);
  });
});
