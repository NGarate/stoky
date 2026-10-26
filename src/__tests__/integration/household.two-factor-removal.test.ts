import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { TRPCError } from "@trpc/server";
import { symmetricDecrypt } from "better-auth/crypto";
import type { HouseholdRole } from "@/generated/prisma/client";
import { POST } from "@/app/api/auth/[...all]/route";
import { readSession } from "@/lib/auth";
import { getAuth } from "@/lib/auth/instance";
import { hotp, totpStep } from "@/lib/auth/policy-plugin";
import { prisma } from "@/lib/prisma";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { freshTestAddress, signInWith, testOrigin } from "../utils/authorize";
import {
  createMockSession,
  createTestHousehold,
  createTestUser,
  generateTestEmail,
} from "../utils/test-helpers";

/**
 * An admin removing a member's two-step verification, for a lost
 * authenticator (`household.removeMemberTwoFactor`, PROGRESS D150).
 *
 * The point is what happens to the member, so every member here enrols for
 * real — through `getAuth().api`, the shortest way to an account that has it,
 * as `two-factor.test.ts` does — signs in for real, and is read back with
 * `readSession`, the read every page and tRPC call makes. A pending sign-in
 * is a real password step through the auth route, left waiting for its code.
 *
 * The admins call the router on a mock session: what is under test is their
 * password and their role, not their cookie.
 */

const PASSWORD = "cocina despensa nevera";
const WRONG_PASSWORD = "no es la contraseña";
const MARKER = `twofa-removal-${process.pid}-${Date.now().toString(36)}`;

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: MARKER } } });
  await prisma.household.deleteMany({ where: { name: { contains: MARKER } } });
});

type Caller = ReturnType<typeof appRouter.createCaller>;

/** The `Cookie` header a browser holding `jar` sends after these `Set-Cookie` lines. */
function mergeJar(jar: string, setCookie: string[]): string {
  const cookies = new Map(
    jar
      .split("; ")
      .filter(Boolean)
      .map((pair) => [pair.split("=", 1)[0], pair] as const),
  );
  for (const line of setCookie) {
    const pair = line.split(";")[0].trim();
    const name = pair.split("=", 1)[0];
    if (/;\s*max-age=0\b/i.test(line) || pair.endsWith("="))
      cookies.delete(name);
    else cookies.set(name, pair);
  }
  return [...cookies.values()].join("; ");
}

const code = (secret: string, steps = 0) =>
  hotp(secret, totpStep(Date.now()) + steps);

async function household(label: string): Promise<string> {
  return (await createTestHousehold({ name: `${MARKER} ${label}` })).id;
}

interface Account {
  id: string;
  email: string;
  caller: Caller;
}

async function account(
  label: string,
  householdId: string,
  role: HouseholdRole,
): Promise<Account> {
  const email = generateTestEmail(`${MARKER}-${label}`);
  const user = await createTestUser({
    email,
    name: `Removal ${label}`,
    password: PASSWORD,
    householdId,
    role,
  });
  const row = await prisma.household.findUniqueOrThrow({
    where: { id: householdId },
  });
  const ctx = await createTRPCContext({
    session: createMockSession({ ...user, household: row }),
    headers: new Headers({ "x-forwarded-for": "203.0.113.32" }),
  });
  return { id: user.id, email, caller: appRouter.createCaller(ctx) };
}

interface Enrolled extends Account {
  /** The authenticator secret, as the lost phone held it. */
  secret: string;
  /** A browser the member is signed in on — the one left on the lost phone. */
  jar: string;
}

/** A member with an authenticator, signed in on the browser that set it up. */
async function enrolled(
  label: string,
  householdId: string,
  role: HouseholdRole = "MEMBER",
): Promise<Enrolled> {
  const member = await account(label, householdId, role);
  const signedIn = await signInWith({
    email: member.email,
    password: PASSWORD,
  });
  expect(signedIn.status).toBe(200);
  let jar = signedIn.cookieHeader;

  const auth = getAuth();
  await auth.api.enableTwoFactor({
    body: { password: PASSWORD },
    headers: new Headers({ cookie: jar }),
  });
  const row = await prisma.twoFactor.findUniqueOrThrow({
    where: { userId: member.id },
  });
  const secret = await symmetricDecrypt({
    key: (await auth.$context).secretConfig,
    data: row.secret,
  });
  const verified = await auth.api.verifyTOTP({
    body: { code: code(secret) },
    headers: new Headers({ cookie: jar }),
    asResponse: true,
  });
  expect(verified.status).toBe(200);
  jar = mergeJar(jar, verified.headers.getSetCookie());
  expect(await signedInAs(jar)).toBe(member.id);
  return { ...member, secret, jar };
}

const signedInAs = async (jar: string) =>
  (await readSession(new Headers({ cookie: jar }), { refresh: false }))?.user
    .id ?? null;

/** A password step on a fresh browser that stops for the code; its jar. */
async function pendingChallenge(
  member: Pick<Account, "email">,
): Promise<string> {
  const answer = await signInWith({ email: member.email, password: PASSWORD });
  expect(answer.status).toBe(200);
  expect(answer.body).toMatchObject({ twoFactorRedirect: true });
  return answer.cookieHeader;
}

/** The code step through the route, as the login form sends it. */
async function verifyTotp(jar: string, totp: string) {
  const response = await POST(
    new Request(`${testOrigin()}/api/auth/two-factor/verify-totp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: jar,
        origin: testOrigin(),
        "x-forwarded-for": freshTestAddress(),
      },
      body: JSON.stringify({ code: totp }),
    }),
  );
  return {
    status: response.status,
    jar: mergeJar(jar, response.headers.getSetCookie()),
  };
}

const challenges = (userId: string) =>
  prisma.verification.count({
    where: { identifier: { startsWith: "2fa-" }, value: userId },
  });

/** What the member's account holds of two-step verification. */
async function twoFactorOf(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const row = await prisma.twoFactor.findUnique({ where: { userId } });
  return { enabled: user.twoFactorEnabled, row: row !== null };
}

async function codeOf(call: Promise<unknown>): Promise<string | null> {
  try {
    await call;
    return null;
  } catch (error) {
    return error instanceof TRPCError ? error.code : "NOT_A_TRPC_ERROR";
  }
}

/** The security lines written while `run` ran: raw, and parsed. */
async function eventsDuring(run: () => Promise<unknown>) {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  let lines: string[];
  try {
    await run();
  } finally {
    lines = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
  }
  return {
    raw: lines.join("\n"),
    events: lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, string>];
      } catch {
        return [];
      }
    }),
  };
}

const remove = (admin: Account, userId: string, currentPassword = PASSWORD) =>
  admin.caller.household.removeMemberTwoFactor({ userId, currentPassword });

describe("an admin removing a member's two-step verification", () => {
  it("takes it off, signs the member out everywhere, and the password alone then signs in", async () => {
    const home = await household("works");
    const admin = await account("works-admin", home, "ADMIN");
    const ana = await enrolled("works-ana", home);
    // The lost phone's browser, and a sign-in somebody has started with the
    // password and is waiting to finish with the phone.
    const pending = await pendingChallenge(ana);
    expect(await challenges(ana.id)).toBe(1);
    expect(await twoFactorOf(ana.id)).toEqual({ enabled: true, row: true });

    let answer: unknown;
    const { raw, events } = await eventsDuring(async () => {
      answer = await remove(admin, ana.id);
    });

    expect(answer).toEqual({ ended: 1 });
    expect(await twoFactorOf(ana.id)).toEqual({ enabled: false, row: false });
    expect(await signedInAs(ana.jar)).toBeNull();
    expect(await prisma.session.count({ where: { userId: ana.id } })).toBe(0);
    // The half-finished sign-in cannot be completed with the lost phone.
    expect(await challenges(ana.id)).toBe(0);
    const finished = await verifyTotp(pending, code(ana.secret, 1));
    expect(finished.status).not.toBe(200);
    expect(await signedInAs(finished.jar)).toBeNull();

    // Who did it to whom, and how many sessions went; never the code, the
    // secret, a password or an email address.
    expect(
      events.filter((line) => line.event === "auth.twofactor.removed"),
    ).toEqual([
      expect.objectContaining({
        userId: admin.id,
        targetUserId: ana.id,
        householdId: home,
      }),
    ]);
    expect(
      events.filter((line) => line.event === "auth.session.ended"),
    ).toEqual([
      expect.objectContaining({
        userId: admin.id,
        targetUserId: ana.id,
        householdId: home,
        reason: "two-factor-removed",
        count: "1",
      }),
    ]);
    for (const secret of [
      ana.secret,
      code(ana.secret),
      code(ana.secret, 1),
      ana.email,
      admin.email,
      PASSWORD,
    ]) {
      expect(raw).not.toContain(secret);
    }

    // The password alone now signs in, with no step for a code.
    const again = await signInWith({ email: ana.email, password: PASSWORD });
    expect(again.status).toBe(200);
    expect(again.body).not.toMatchObject({ twoFactorRedirect: true });
    expect(await signedInAs(again.cookieHeader)).toBe(ana.id);
  });

  it("lets an owner remove another owner's", async () => {
    const home = await household("owners");
    const owner = await account("owners-owner", home, "OWNER");
    const coOwner = await enrolled("owners-co", home, "OWNER");

    expect(await remove(owner, coOwner.id)).toEqual({ ended: 1 });
    expect(await twoFactorOf(coOwner.id)).toEqual({
      enabled: false,
      row: false,
    });
    expect(await signedInAs(coOwner.jar)).toBeNull();
  });
});

describe("what it refuses, changing nothing", () => {
  it("refuses a wrong admin password, and records it", async () => {
    const home = await household("wrong");
    const admin = await account("wrong-admin", home, "ADMIN");
    const ana = await enrolled("wrong-ana", home);

    let refused = null as string | null;
    const { events } = await eventsDuring(async () => {
      refused = await codeOf(remove(admin, ana.id, WRONG_PASSWORD));
    });

    expect(refused).toBe("BAD_REQUEST");
    expect(await twoFactorOf(ana.id)).toEqual({ enabled: true, row: true });
    expect(await signedInAs(ana.jar)).toBe(ana.id);
    expect(
      events.filter((line) => line.event === "auth.reauth.refused"),
    ).toEqual([
      expect.objectContaining({ userId: admin.id, via: "member-two-factor" }),
    ]);
    expect(events.some((line) => line.event === "auth.twofactor.removed")).toBe(
      false,
    );

    // The password is asked before the member is looked up, so a session
    // somebody else holds learns nothing about which ids exist.
    expect(await codeOf(remove(admin, "no-such-member", WRONG_PASSWORD))).toBe(
      "BAD_REQUEST",
    );
  });

  it("refuses an admin acting on an owner", async () => {
    const home = await household("owner");
    const admin = await account("owner-admin", home, "ADMIN");
    const owner = await enrolled("owner-owner", home, "OWNER");

    expect(await codeOf(remove(admin, owner.id))).toBe("FORBIDDEN");
    expect(await twoFactorOf(owner.id)).toEqual({ enabled: true, row: true });
    expect(await signedInAs(owner.jar)).toBe(owner.id);
  });

  it("refuses another household's member as not found, a member as the caller, and the caller's own", async () => {
    const home = await household("reach");
    const elsewhere = await household("reach-elsewhere");
    const owner = await enrolled("reach-owner", home, "OWNER");
    const member = await account("reach-member", home, "MEMBER");
    const ana = await enrolled("reach-ana", home);
    const outsider = await enrolled("reach-outsider", elsewhere);

    expect(await codeOf(remove(owner, outsider.id))).toBe("NOT_FOUND");
    // `adminProcedure`: a member is refused before any of it.
    expect(await codeOf(remove(member, ana.id))).toBe("FORBIDDEN");
    // Your own is turned off from Seguridad y acceso, owners included.
    expect(await codeOf(remove(owner, owner.id))).toBe("BAD_REQUEST");

    for (const person of [owner, ana, outsider]) {
      expect(await twoFactorOf(person.id)).toEqual({
        enabled: true,
        row: true,
      });
      expect(await signedInAs(person.jar)).toBe(person.id);
    }
  });

  it("refuses a member who has none as a conflict, and ends none of their sessions", async () => {
    const home = await household("none");
    const admin = await account("none-admin", home, "ADMIN");
    const bea = await account("none-bea", home, "MEMBER");
    const signedIn = await signInWith({ email: bea.email, password: PASSWORD });
    expect(signedIn.status).toBe(200);

    let refused = null as string | null;
    const { events } = await eventsDuring(async () => {
      refused = await codeOf(remove(admin, bea.id));
    });

    expect(refused).toBe("CONFLICT");
    expect(await signedInAs(signedIn.cookieHeader)).toBe(bea.id);
    expect(events.some((line) => line.event === "auth.session.ended")).toBe(
      false,
    );
    expect(events.some((line) => line.event === "auth.twofactor.removed")).toBe(
      false,
    );
  });
});
