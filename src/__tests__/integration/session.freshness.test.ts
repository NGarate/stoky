import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TRPCError } from "@trpc/server";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
import {
  createTestHousehold,
  createTestUser,
  generateTestEmail,
} from "../utils/test-helpers";

/**
 * What a live session stops being able to do, and how quickly —
 * `docs/SECURITY_REVIEW.md` finding 8.
 *
 * When the review was written the session was a JWT with **no server-side
 * record**, so there was nothing to revoke; it is a database row now (PROGRESS
 * D135), and ending one deletes it. What the review also says, as the reason
 * the exposure is smaller than it sounds, is that *the role is read fresh per
 * request* — and that still holds, and still needed a test.
 *
 * It matters more than a coverage gap. `householdProcedure` re-reads
 * `householdId` and `role` from the database on every call and ignores what the
 * token claims. That single query is the **only** thing this application can do
 * about a session it wants to stop trusting. Replace it with the token's own
 * values — an obvious optimisation, one fewer query per request — and every
 * gate stays green while the last mitigation disappears.
 *
 * So these tests are not about `householdProcedure` being correct. They are
 * about it staying the thing the security review's reasoning depends on.
 *
 * **What they also establish, by being possible to write at all:** every state
 * change below has to be made with a direct database write, because the
 * application offers no way to make it. `householdRouter` has `current`,
 * `create`, `members` and `addMember` — there is no way to remove a member and
 * no way to change a role. So the review's "a role change bites on the next
 * request" is true and unreachable: nothing in the product can change a role.
 * A household that loses its kitchen tablet has no answer from inside the
 * application at all, which is a sharper version of the finding than it was
 * filed with.
 */

const HOUSEHOLD = "Session Freshness Household";
const PREFIX = "Session Freshness ";

type Caller = ReturnType<typeof appRouter.createCaller>;

let householdId: string;

/**
 * A caller whose *token* says what `claims` says, whatever the database holds.
 *
 * Built by hand rather than with `createMockSession`, which reads the row —
 * the whole point here is to let the two disagree.
 */
async function callerWithClaims(claims: {
  userId: string;
  householdId?: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "KITCHEN";
}): Promise<Caller> {
  const ctx = await createTRPCContext({
    session: {
      user: {
        id: claims.userId,
        email: `${claims.userId}@example.com`,
        name: `${PREFIX}Token`,
        householdId: claims.householdId,
        role: claims.role,
      },
      expires: new Date(Date.now() + 3600 * 1000).toISOString(),
      sessionId: crypto.randomUUID(),
    },
  });
  return appRouter.createCaller(ctx);
}

async function codeOf(call: () => Promise<unknown>): Promise<string | null> {
  try {
    await call();
    return null;
  } catch (error) {
    return error instanceof TRPCError ? error.code : "NOT_A_TRPC_ERROR";
  }
}

beforeAll(async () => {
  const household = await createTestHousehold({ name: HOUSEHOLD });
  householdId = household.id;
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { householdId } });
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.household.deleteMany({ where: { id: householdId } });
});

describe("a token that outlives the account", () => {
  it("stops working on the next request", async () => {
    // The nearest thing to revocation this application has, and it is not a
    // feature — it is what happens when the row goes. Reaching it needs a
    // direct database write, because nothing in the product deletes a user.
    const user = await createTestUser({
      email: generateTestEmail("freshness-deleted"),
      name: `${PREFIX}Deleted`,
      password: "cocina despensa nevera",
      householdId,
      role: "MEMBER",
    });

    const caller = await callerWithClaims({
      userId: user.id,
      householdId,
      role: "MEMBER",
    });

    // The premise: the token works while the row exists.
    expect(await codeOf(() => caller.product.list({}))).toBeNull();

    await prisma.user.delete({ where: { id: user.id } });

    expect(await codeOf(() => caller.product.list({}))).toBe("UNAUTHORIZED");
  });
});

describe("a token that claims more than the database allows", () => {
  it("is held to the database's role, not its own", async () => {
    // The claim the security review's reasoning rests on. The token says
    // OWNER; the row says KITCHEN; the write must be refused.
    const user = await createTestUser({
      email: generateTestEmail("freshness-demoted"),
      name: `${PREFIX}Demoted`,
      password: "cocina despensa nevera",
      householdId,
      role: "KITCHEN",
    });

    const caller = await callerWithClaims({
      userId: user.id,
      householdId,
      role: "OWNER",
    });

    expect(
      await codeOf(() =>
        caller.product.create({ name: `${PREFIX}Should Not Exist`, defaultUnit: "unit" }),
      ),
    ).toBe("FORBIDDEN");

    // And nothing was written on the way to being refused.
    expect(
      await prisma.product.count({ where: { name: `${PREFIX}Should Not Exist` } }),
    ).toBe(0);
  });

  it("takes a demotion on the very next call, with no sign-out in between", async () => {
    // "A role change bites on the next request", asserted rather than asserted
    // about. The same caller object, the same token, one database write in the
    // middle.
    const user = await createTestUser({
      email: generateTestEmail("freshness-live"),
      name: `${PREFIX}Live`,
      password: "cocina despensa nevera",
      householdId,
      role: "MEMBER",
    });

    const caller = await callerWithClaims({
      userId: user.id,
      householdId,
      role: "MEMBER",
    });

    expect(
      await codeOf(() =>
        caller.product.create({ name: `${PREFIX}Allowed`, defaultUnit: "unit" }),
      ),
    ).toBeNull();

    await prisma.user.update({
      where: { id: user.id },
      data: { role: "KITCHEN" },
    });

    expect(
      await codeOf(() =>
        caller.product.create({ name: `${PREFIX}Refused`, defaultUnit: "unit" }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("is held to the database's household, not its own", async () => {
    // A token naming another household must not reach it. The row's
    // `householdId` is what the resolver receives, so the claim is inert.
    const stranger = await createTestHousehold({ name: `${HOUSEHOLD} Stranger` });
    const user = await createTestUser({
      email: generateTestEmail("freshness-household"),
      name: `${PREFIX}Household`,
      password: "cocina despensa nevera",
      householdId,
      role: "MEMBER",
    });

    const strangersProduct = await prisma.product.create({
      data: { name: `${PREFIX}Stranger Product`, defaultUnit: "unit", householdId: stranger.id },
    });

    const caller = await callerWithClaims({
      userId: user.id,
      householdId: stranger.id,
      role: "MEMBER",
    });

    try {
      const listed = await caller.product.list({});
      const names = listed.products.map((product) => product.name);
      expect(names).not.toContain(`${PREFIX}Stranger Product`);
    } finally {
      await prisma.product.deleteMany({ where: { householdId: stranger.id } });
      await prisma.household.deleteMany({ where: { id: stranger.id } });
    }

    expect(strangersProduct.householdId).toBe(stranger.id);
  });
});
