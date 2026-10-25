import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { HouseholdRole } from "@prisma/client";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import {
  createMockSession,
  createTestHousehold,
  createTestUser,
  generateTestEmail,
} from "../utils/test-helpers";

/**
 * Changing a member's role, and removing one — `REDESIGN_PLAN.md` §10's
 * household admin panel, server half.
 *
 * `addMemberSchema` has said since it was written that promoting somebody
 * "deserves its own procedure and its own thought". This is that procedure, and
 * the thought is three invariants, each of which is a way a household could
 * otherwise lose control of itself:
 *
 * 1. **The member must be this household's.** The class
 *    `SECURITY_REVIEW.md` §2 found four times, and the one that matters most
 *    here — a caller-supplied `userId` that is written to.
 * 2. **Only an owner may grant or revoke ownership.** Without it an admin
 *    demotes every owner and takes the household: privilege escalation dressed
 *    as member management.
 * 3. **The household keeps an owner.** The invariant §10 named as the design
 *    question to settle first, because it is the one that bites late.
 *
 * The last tests hold the second line of defence: a removal takes effect on
 * the very next request, because `householdProcedure` re-reads the household
 * rather than trusting the token. Removal also ends the member's sessions
 * (PROGRESS D146, `household.members.test.ts`); these callers carry a session
 * that is never read back, so they prove the re-read on its own.
 */

const PREFIX = "Roles ";
let householdId: string;
let strangerHouseholdId: string;

type Caller = ReturnType<typeof appRouter.createCaller>;

async function member(
  role: HouseholdRole,
  label: string,
  household = householdId,
): Promise<{ id: string; caller: Caller }> {
  const householdRow = await prisma.household.findUniqueOrThrow({
    where: { id: household },
  });
  const user = await createTestUser({
    email: generateTestEmail(`roles-${label.toLowerCase()}`),
    name: `${PREFIX}${label}`,
    password: "cocina despensa nevera",
    householdId: household,
    role,
  });
  const ctx = await createTRPCContext({
    session: createMockSession({ ...user, household: householdRow }),
  });
  return { id: user.id, caller: appRouter.createCaller(ctx) };
}

async function codeOf(call: () => Promise<unknown>): Promise<string | null> {
  try {
    await call();
    return null;
  } catch (error) {
    return error instanceof TRPCError ? error.code : "NOT_A_TRPC_ERROR";
  }
}

const roleOf = async (id: string) =>
  (
    await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { role: true },
    })
  ).role;

beforeEach(async () => {
  // A household per test: these procedures count owners, so tests sharing one
  // would decide each other's outcomes.
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.household.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  householdId = (await createTestHousehold({ name: `${PREFIX}Household` })).id;
  strangerHouseholdId = (
    await createTestHousehold({ name: `${PREFIX}Stranger` })
  ).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.household.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
});

describe("whose member it is", () => {
  it("refuses a userId from another household, and changes nothing", async () => {
    const { caller } = await member("OWNER", "Owner");
    const outsider = await member("MEMBER", "Outsider", strangerHouseholdId);

    expect(
      await codeOf(() =>
        caller.household.updateRole({ userId: outsider.id, role: "ADMIN" }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await codeOf(() =>
        caller.household.removeMember({ userId: outsider.id }),
      ),
    ).toBe("NOT_FOUND");

    expect(await roleOf(outsider.id)).toBe("MEMBER");
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: outsider.id },
    });
    expect(row.householdId).toBe(strangerHouseholdId);
  });
});

describe("who may touch ownership", () => {
  it("refuses an admin trying to demote an owner", async () => {
    // The escalation this guard exists for: demote every owner, then be the
    // only one left who can do anything.
    await member("OWNER", "Owner");
    const { caller: admin } = await member("ADMIN", "Admin");
    const owner = await member("OWNER", "Second");

    expect(
      await codeOf(() =>
        admin.household.updateRole({ userId: owner.id, role: "MEMBER" }),
      ),
    ).toBe("FORBIDDEN");
    expect(await roleOf(owner.id)).toBe("OWNER");
  });

  it("refuses an admin trying to make anyone an owner, including themselves", async () => {
    await member("OWNER", "Owner");
    const admin = await member("ADMIN", "Admin");

    expect(
      await codeOf(() =>
        admin.caller.household.updateRole({ userId: admin.id, role: "OWNER" }),
      ),
    ).toBe("FORBIDDEN");
    expect(await roleOf(admin.id)).toBe("ADMIN");
  });

  it("refuses an admin removing an owner", async () => {
    await member("OWNER", "Owner");
    const { caller: admin } = await member("ADMIN", "Admin");
    const owner = await member("OWNER", "Second");

    expect(
      await codeOf(() => admin.household.removeMember({ userId: owner.id })),
    ).toBe("FORBIDDEN");
  });

  it("lets an owner do all of it", async () => {
    const { caller: owner } = await member("OWNER", "Owner");
    const other = await member("MEMBER", "Other");

    expect(
      (await owner.household.updateRole({ userId: other.id, role: "OWNER" }))
        .role,
    ).toBe("OWNER");
    expect(
      (await owner.household.updateRole({ userId: other.id, role: "KITCHEN" }))
        .role,
    ).toBe("KITCHEN");
  });
});

describe("the household keeps an owner", () => {
  it("refuses the last owner demoting themselves", async () => {
    // The lock-out this invariant exists for, and the likeliest way to reach
    // it: one owner, tidying up their own role.
    const sole = await member("OWNER", "Sole");

    expect(
      await codeOf(() =>
        sole.caller.household.updateRole({ userId: sole.id, role: "ADMIN" }),
      ),
    ).toBe("CONFLICT");
    expect(await roleOf(sole.id)).toBe("OWNER");
  });

  it("refuses the last owner being removed", async () => {
    const sole = await member("OWNER", "Sole");

    expect(
      await codeOf(() =>
        sole.caller.household.removeMember({ userId: sole.id }),
      ),
    ).toBe("CONFLICT");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: sole.id } });
    expect(row.householdId).toBe(householdId);
  });

  it("allows it once somebody else owns the household", async () => {
    // The escape the CONFLICT message names: promote first, then leave. Without
    // this the invariant would be a trap rather than a guard.
    const first = await member("OWNER", "First");
    const second = await member("MEMBER", "Second");

    await first.caller.household.updateRole({
      userId: second.id,
      role: "OWNER",
    });

    expect(
      await codeOf(() =>
        first.caller.household.updateRole({ userId: first.id, role: "MEMBER" }),
      ),
    ).toBeNull();
    expect(await roleOf(first.id)).toBe("MEMBER");
  });

  it("keeps an owner when two owners step down at the same moment", async () => {
    // Each call, alone, is allowed: there is another owner. Together they
    // leave none. The count and the write were separate statements outside
    // any transaction, so both counts could see two owners before either
    // write landed. Repeated, because a race that loses once proves nothing.
    const outcomes: string[] = [];

    for (let round = 0; round < 5; round++) {
      await prisma.user.deleteMany({
        where: { householdId, name: { startsWith: PREFIX } },
      });
      const first = await member("OWNER", `RaceA${round}`);
      const second = await member("OWNER", `RaceB${round}`);

      const [a, b] = await Promise.all([
        codeOf(() =>
          first.caller.household.updateRole({
            userId: first.id,
            role: "MEMBER",
          }),
        ),
        codeOf(() =>
          second.caller.household.removeMember({ userId: second.id }),
        ),
      ]);
      outcomes.push(`${a}/${b}`);

      const owners = await prisma.user.count({
        where: { householdId, role: "OWNER" },
      });
      expect({ round, owners, outcomes }).toEqual({
        round,
        owners: 1,
        outcomes,
      });

      // Exactly one of the two went ahead, and the other was told why.
      expect([a, b].filter((code) => code === null)).toHaveLength(1);
      expect([a, b].filter((code) => code === "CONFLICT")).toHaveLength(1);
    }
  });
});

describe("when it takes effect", () => {
  it("bites on the removed member's very next request", async () => {
    // Removal also deletes the member's sessions (D146), but this caller's
    // session is a mock that nothing reads back, so what refuses it here is
    // `householdProcedure` re-reading the household rather than trusting the
    // token — the guard that holds even for a session not yet ended.
    const { caller: owner } = await member("OWNER", "Owner");
    const target = await member("MEMBER", "Target");

    // The premise: the member can use the application.
    expect(await codeOf(() => target.caller.product.list({}))).toBeNull();

    await owner.household.removeMember({ userId: target.id });

    // Same caller, same token, no sign-out in between.
    expect(await codeOf(() => target.caller.product.list({}))).toBe(
      "PRECONDITION_FAILED",
    );
  });

  it("bites on a demoted member's very next write", async () => {
    const { caller: owner } = await member("OWNER", "Owner");
    const target = await member("MEMBER", "Target");

    expect(
      await codeOf(() =>
        target.caller.product.create({
          name: `${PREFIX}Allowed`,
          defaultUnit: "unit",
        }),
      ),
    ).toBeNull();

    await owner.household.updateRole({ userId: target.id, role: "KITCHEN" });

    expect(
      await codeOf(() =>
        target.caller.product.create({
          name: `${PREFIX}Refused`,
          defaultUnit: "unit",
        }),
      ),
    ).toBe("FORBIDDEN");

    await prisma.product.deleteMany({
      where: { name: { startsWith: PREFIX } },
    });
  });
});
