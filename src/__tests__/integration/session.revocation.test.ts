import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { HouseholdRole } from "@prisma/client";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { authConfig } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createMockSession,
  createTestHousehold,
  createTestUser,
  generateTestEmail,
} from "../utils/test-helpers";

/**
 * Session revocation — `REDESIGN_PLAN.md` §10, and the "yes" to
 * `SECURITY_REVIEW.md` finding 8's open question.
 *
 * **The procedures are the easy half.** Writing a timestamp is not a feature;
 * the feature is that a token issued before it stops working. That happens in
 * `authConfig.callbacks.jwt`, which returns `null` and makes Auth.js clear the
 * cookie — so that callback is what these tests drive, directly, the way
 * `utils/authorize.ts` drives `authorize` rather than asserting about it.
 *
 * Two things make this worth pinning beyond "it works":
 *
 * - **The check must survive the re-issue.** `jwt.encode` calls
 *   `.setIssuedAt()`, so `iat` slides forward every five minutes on an active
 *   session. The callback runs *before* that, which is the only reason a
 *   revocation catches anything at all — and an implementation that checked
 *   afterwards would pass a naive test and revoke nothing.
 * - **Signing in again must work.** On sign-in the callback receives `user` and
 *   a token with no `iat` yet. Refusing there would turn revocation into a
 *   lockout, which is a worse bug than the one it fixes. Two separate lines
 *   hold that, so the test is proven against the mutation that defeats both.
 */

const PREFIX = "Revocation ";
let householdId: string;

type Caller = ReturnType<typeof appRouter.createCaller>;

/** The configured `jwt` callback, which is where revocation actually happens. */
function jwtCallback() {
  const callback = authConfig.callbacks?.jwt;
  if (typeof callback !== "function") {
    throw new Error("authConfig exposes no jwt callback");
  }
  return callback;
}

/** A token as Auth.js would hand it to the callback, `iat` in seconds. */
function tokenIssuedAt(userId: string, when: Date) {
  return { sub: userId, iat: Math.floor(when.getTime() / 1000) };
}

async function accountWithCaller(
  role: HouseholdRole,
  label: string,
): Promise<{ id: string; caller: Caller }> {
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: householdId },
  });
  const user = await createTestUser({
    email: generateTestEmail(`revoke-${label.toLowerCase()}`),
    name: `${PREFIX}${label}`,
    password: "cocina despensa nevera",
    householdId,
    role,
  });
  const ctx = await createTRPCContext({
    session: createMockSession({ ...user, household }),
  });
  return { id: user.id, caller: appRouter.createCaller(ctx) };
}

const validFrom = async (id: string) =>
  (
    await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { sessionsValidFrom: true },
    })
  ).sessionsValidFrom;

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.household.deleteMany({ where: { name: { startsWith: PREFIX } } });
  householdId = (await createTestHousehold({ name: `${PREFIX}Household` })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.household.deleteMany({ where: { name: { startsWith: PREFIX } } });
});

describe("what a revoked token does", () => {
  it("is refused, which is what clears the cookie", async () => {
    // `null` is not a detail: `@auth/core/lib/actions/session.js` pushes
    // `sessionStore.clean()` on exactly that value. Returning anything else —
    // an empty token, the token unchanged — leaves the session standing.
    const { id, caller } = await accountWithCaller("MEMBER", "Refused");
    const issued = new Date(Date.now() - 60_000);

    await caller.auth.revokeMySessions();

    const result = await jwtCallback()({
      token: tokenIssuedAt(id, issued),
    } as never);

    expect(result).toBeNull();
  });

  it("leaves a token issued after the line alone", async () => {
    // The other half, and the one that stops this being a sign-everybody-out
    // switch: revocation is a line, not a flag.
    const { id, caller } = await accountWithCaller("MEMBER", "Later");

    await caller.auth.revokeMySessions();
    const line = await validFrom(id);
    expect(line).not.toBeNull();

    const result = await jwtCallback()({
      token: tokenIssuedAt(id, new Date((line as Date).getTime() + 1000)),
    } as never);

    expect(result).not.toBeNull();
  });

  it("leaves an account nobody has revoked alone", async () => {
    const { id } = await accountWithCaller("MEMBER", "Untouched");

    expect(await validFrom(id)).toBeNull();
    expect(
      await jwtCallback()({ token: tokenIssuedAt(id, new Date()) } as never),
    ).not.toBeNull();
  });

  it("lets the account sign in again afterwards", async () => {
    // On sign-in the callback gets `user` and a token with no `iat` — it is
    // stamped after. Refusing there would make revocation a lockout, which is
    // worse than the problem it solves.
    //
    // **Two independent things hold this**, which is worth saying because
    // removing either alone leaves the test green: the early return on `user`,
    // and the `iat === null` guard below it. Measured — deleting the early
    // return changes nothing. What does turn this red is treating a missing
    // `iat` as zero, and that is the mutation this test is proven against.
    const { id, caller } = await accountWithCaller("MEMBER", "ComesBack");
    await caller.auth.revokeMySessions();

    const freshSignIn = await jwtCallback()({
      token: { sub: id },
      user: { id, householdId, role: "MEMBER" },
      trigger: "signIn",
    } as never);

    expect(freshSignIn).not.toBeNull();
  });
});

describe("who may end whose sessions", () => {
  it("lets an account end its own", async () => {
    const { id, caller } = await accountWithCaller("KITCHEN", "Own");

    expect(await validFrom(id)).toBeNull();
    await caller.auth.revokeMySessions();
    expect(await validFrom(id)).not.toBeNull();
  });

  it("lets an admin end a member's", async () => {
    const { caller: admin } = await accountWithCaller("ADMIN", "Admin");
    const target = await accountWithCaller("KITCHEN", "Tablet");

    await admin.household.revokeMemberSessions({ userId: target.id });

    expect(await validFrom(target.id)).not.toBeNull();
  });

  it("refuses a member from another household, and revokes nothing", async () => {
    const { caller: admin } = await accountWithCaller("ADMIN", "Admin");
    const stranger = await createTestHousehold({ name: `${PREFIX}Stranger` });
    const outsider = await createTestUser({
      email: generateTestEmail("revoke-outsider"),
      name: `${PREFIX}Outsider`,
      password: "cocina despensa nevera",
      householdId: stranger.id,
      role: "MEMBER",
    });

    let code: string | null = null;
    try {
      await admin.household.revokeMemberSessions({ userId: outsider.id });
    } catch (error) {
      code = error instanceof TRPCError ? error.code : "NOT_A_TRPC_ERROR";
    }

    expect(code).toBe("NOT_FOUND");
    expect(await validFrom(outsider.id)).toBeNull();

    await prisma.user.deleteMany({ where: { id: outsider.id } });
    await prisma.household.deleteMany({ where: { id: stranger.id } });
  });

  it("refuses an admin ending an owner's", async () => {
    // The same guard as the rest of member management: an admin who could sign
    // an owner out could lock them out of answering.
    const { caller: admin } = await accountWithCaller("ADMIN", "Admin");
    const owner = await accountWithCaller("OWNER", "Owner");

    let code: string | null = null;
    try {
      await admin.household.revokeMemberSessions({ userId: owner.id });
    } catch (error) {
      code = error instanceof TRPCError ? error.code : "NOT_A_TRPC_ERROR";
    }

    expect(code).toBe("FORBIDDEN");
    expect(await validFrom(owner.id)).toBeNull();
  });

  it("lets an owner end another owner's, including the last one's", async () => {
    // Deliberately no last-owner guard here. Ending sessions changes nothing
    // about who owns the household, and refusing the sole owner would refuse
    // exactly the person most likely to have lost a device.
    const sole = await accountWithCaller("OWNER", "Sole");

    await sole.caller.household.revokeMemberSessions({ userId: sole.id });

    expect(await validFrom(sole.id)).not.toBeNull();
  });
});
