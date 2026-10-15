import { describe, it, expect, beforeEach, afterAll, spyOn } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { HouseholdRole } from "@prisma/client";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { signInWith } from "../utils/authorize";
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
 * **The procedures are the easy half.** Deleting rows is not a feature; the
 * feature is that a cookie already in somebody's browser stops working. So
 * every account here signs in for real, through the auth route, and the
 * cookie it got is read back with `readSession` — the read every page and
 * every tRPC call makes — before and after. The "before" is the control: it
 * shows the cookie worked, so the "after" is the revocation's doing.
 */

const PREFIX = "Revocation ";
const PASSWORD = "cocina despensa nevera";
let householdId: string;

type Caller = ReturnType<typeof appRouter.createCaller>;

interface Account {
  id: string;
  caller: Caller;
  /** The headers of a browser this account signed in on. */
  browser: Headers;
}

async function accountWithCaller(role: HouseholdRole, label: string, inHousehold = householdId): Promise<Account> {
  const household = await prisma.household.findUniqueOrThrow({ where: { id: inHousehold } });
  const email = generateTestEmail(`revoke-${label.toLowerCase()}`);
  const user = await createTestUser({
    email,
    name: `${PREFIX}${label}`,
    password: PASSWORD,
    householdId: inHousehold,
    role,
  });
  const signedIn = await signInWith({ email, password: PASSWORD });
  expect(signedIn.status).toBe(200);
  const ctx = await createTRPCContext({ session: createMockSession({ ...user, household }) });
  return {
    id: user.id,
    caller: appRouter.createCaller(ctx),
    browser: new Headers({ cookie: signedIn.cookieHeader }),
  };
}

const signedIn = async (account: Account) =>
  (await readSession(account.browser, { refresh: false })) !== null;
const rows = (id: string) => prisma.session.count({ where: { userId: id } });

async function codeOf(call: Promise<unknown>): Promise<string | null> {
  try {
    await call;
    return null;
  } catch (error) {
    return error instanceof TRPCError ? error.code : "NOT_A_TRPC_ERROR";
  }
}

/** The security events written while `run` ran, parsed. */
async function eventsDuring(run: () => Promise<unknown>) {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  let lines: string[];
  try {
    await run();
  } finally {
    lines = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
  }
  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, string>];
    } catch {
      return [];
    }
  });
}

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.household.deleteMany({ where: { name: { startsWith: PREFIX } } });
  householdId = (await createTestHousehold({ name: `${PREFIX}Household` })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.household.deleteMany({ where: { name: { startsWith: PREFIX } } });
});

describe("what ending a session does", () => {
  it("refuses a cookie already issued, and deletes its row", async () => {
    const account = await accountWithCaller("MEMBER", "Refused");
    expect(await signedIn(account)).toBe(true);

    await account.caller.auth.revokeMySessions();

    expect(await rows(account.id)).toBe(0);
    expect(await signedIn(account)).toBe(false);
  });

  it("leaves another account's sessions alone", async () => {
    // The other half, and the one that stops this being a sign-everybody-out
    // switch.
    const mine = await accountWithCaller("MEMBER", "Mine");
    const theirs = await accountWithCaller("MEMBER", "Theirs");

    await mine.caller.auth.revokeMySessions();

    expect(await signedIn(theirs)).toBe(true);
    expect(await rows(theirs.id)).toBe(1);
  });

  it("lets the account sign in again afterwards", async () => {
    // Revocation is not a lockout: a fresh sign-in is a fresh row.
    const account = await accountWithCaller("MEMBER", "ComesBack");
    await account.caller.auth.revokeMySessions();

    const email = (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).email;
    const again = await signInWith({ email, password: PASSWORD });

    expect(again.status).toBe(200);
    expect(await readSession(new Headers({ cookie: again.cookieHeader }), { refresh: false })).not.toBeNull();
  });

  it("is recorded, with who asked and how many sessions went", async () => {
    const account = await accountWithCaller("MEMBER", "Recorded");

    const events = await eventsDuring(() => account.caller.auth.revokeMySessions());

    const ended = events.filter((event) => event.event === "auth.session.ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({
      userId: account.id,
      targetUserId: account.id,
      reason: "self",
      count: "1",
    });
  });
});

describe("who may end whose sessions", () => {
  it("lets an account end its own", async () => {
    const own = await accountWithCaller("KITCHEN", "Own");

    await own.caller.auth.revokeMySessions();

    expect(await signedIn(own)).toBe(false);
  });

  it("lets an admin end a member's, and records that it was the admin", async () => {
    const admin = await accountWithCaller("ADMIN", "Admin");
    const target = await accountWithCaller("KITCHEN", "Tablet");

    const events = await eventsDuring(() =>
      admin.caller.household.revokeMemberSessions({ userId: target.id }),
    );

    expect(await signedIn(target)).toBe(false);
    expect(await signedIn(admin)).toBe(true);
    expect(events.find((event) => event.event === "auth.session.ended")).toMatchObject({
      userId: admin.id,
      targetUserId: target.id,
      reason: "admin",
      count: "1",
    });
  });

  it("refuses a member from another household, and ends nothing", async () => {
    const admin = await accountWithCaller("ADMIN", "Admin");
    const stranger = await createTestHousehold({ name: `${PREFIX}Stranger` });
    const outsider = await accountWithCaller("MEMBER", "Outsider", stranger.id);

    expect(await codeOf(admin.caller.household.revokeMemberSessions({ userId: outsider.id }))).toBe(
      "NOT_FOUND",
    );
    expect(await signedIn(outsider)).toBe(true);
  });

  it("refuses an admin ending an owner's", async () => {
    // The same guard as the rest of member management: an admin who could sign
    // an owner out could lock them out of answering.
    const admin = await accountWithCaller("ADMIN", "Admin");
    const owner = await accountWithCaller("OWNER", "Owner");

    expect(await codeOf(admin.caller.household.revokeMemberSessions({ userId: owner.id }))).toBe(
      "FORBIDDEN",
    );
    expect(await signedIn(owner)).toBe(true);
  });

  it("lets an owner end another owner's, including the last one's", async () => {
    // Deliberately no last-owner guard here. Ending sessions changes nothing
    // about who owns the household, and refusing the sole owner would refuse
    // exactly the person most likely to have lost a device.
    const sole = await accountWithCaller("OWNER", "Sole");

    await sole.caller.household.revokeMemberSessions({ userId: sole.id });

    expect(await signedIn(sole)).toBe(false);
  });
});
