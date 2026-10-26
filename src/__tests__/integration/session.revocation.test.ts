import { describe, it, expect, beforeEach, afterAll, spyOn } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { HouseholdRole } from "@/generated/prisma/client";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { signInWith, testOrigin } from "../utils/authorize";
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

async function accountWithCaller(
  role: HouseholdRole,
  label: string,
  inHousehold = householdId,
): Promise<Account> {
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: inHousehold },
  });
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
  const ctx = await createTRPCContext({
    session: createMockSession({ ...user, household }),
  });
  return {
    id: user.id,
    caller: appRouter.createCaller(ctx),
    browser: new Headers({ cookie: signedIn.cookieHeader }),
  };
}

/** Every session the account has, the way the settings screen ends them. */
const endAll = (account: Account) =>
  account.caller.auth.endSessions({ currentPassword: PASSWORD, scope: "all" });

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
  await prisma.household.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  householdId = (await createTestHousehold({ name: `${PREFIX}Household` })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.household.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
});

describe("what ending a session does", () => {
  it("refuses a cookie already issued, and deletes its row", async () => {
    const account = await accountWithCaller("MEMBER", "Refused");
    expect(await signedIn(account)).toBe(true);

    await endAll(account);

    expect(await rows(account.id)).toBe(0);
    expect(await signedIn(account)).toBe(false);
  });

  it("leaves another account's sessions alone", async () => {
    // The other half, and the one that stops this being a sign-everybody-out
    // switch.
    const mine = await accountWithCaller("MEMBER", "Mine");
    const theirs = await accountWithCaller("MEMBER", "Theirs");

    await endAll(mine);

    expect(await signedIn(theirs)).toBe(true);
    expect(await rows(theirs.id)).toBe(1);
  });

  it("lets the account sign in again afterwards", async () => {
    // Revocation is not a lockout: a fresh sign-in is a fresh row.
    const account = await accountWithCaller("MEMBER", "ComesBack");
    await endAll(account);

    const email = (
      await prisma.user.findUniqueOrThrow({ where: { id: account.id } })
    ).email;
    const again = await signInWith({ email, password: PASSWORD });

    expect(again.status).toBe(200);
    expect(
      await readSession(new Headers({ cookie: again.cookieHeader }), {
        refresh: false,
      }),
    ).not.toBeNull();
  });

  it("is recorded, with who asked and how many sessions went", async () => {
    const account = await accountWithCaller("MEMBER", "Recorded");

    const events = await eventsDuring(() => endAll(account));

    const ended = events.filter(
      (event) => event.event === "auth.session.ended",
    );
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

    await endAll(own);

    expect(await signedIn(own)).toBe(false);
  });

  it("lets an admin end every one of a member's, and records that it was the admin", async () => {
    const admin = await accountWithCaller("ADMIN", "Admin");
    const target = await accountWithCaller("KITCHEN", "Tablet");

    let answer: unknown;
    const events = await eventsDuring(async () => {
      answer = await admin.caller.household.endMemberSessions({
        userId: target.id,
      });
    });

    // The count and nothing else: no token, no row.
    expect(answer).toEqual({ ended: 1 });
    expect(await signedIn(target)).toBe(false);
    expect(await signedIn(admin)).toBe(true);
    expect(
      events.filter((event) => event.event === "auth.session.ended"),
    ).toEqual([
      expect.objectContaining({
        userId: admin.id,
        targetUserId: target.id,
        reason: "admin",
        count: "1",
      }),
    ]);
  });

  it("lets an admin end one of a member's sessions, and leaves the others", async () => {
    // The lost kitchen tablet, and not the phone in the member's pocket.
    const admin = await accountWithCaller("ADMIN", "Admin");
    const target = await accountWithCaller("MEMBER", "TwoDevices");
    const email = (
      await prisma.user.findUniqueOrThrow({ where: { id: target.id } })
    ).email;
    const second = await signInWith({ email, password: PASSWORD });
    const phone = new Headers({ cookie: second.cookieHeader });
    const tablet = await readSession(target.browser, { refresh: false });
    if (!tablet) throw new Error("the member's first browser is not signed in");

    const answer = await admin.caller.household.endMemberSessions({
      userId: target.id,
      sessionId: tablet.sessionId,
    });

    expect(answer).toEqual({ ended: 1 });
    expect(await signedIn(target)).toBe(false);
    expect(await readSession(phone, { refresh: false })).not.toBeNull();
  });

  it("lists a member's live sessions for an admin, with no token and no device id", async () => {
    const admin = await accountWithCaller("ADMIN", "Admin");
    const target = await accountWithCaller("KITCHEN", "Listed");
    const deviceId = crypto.randomUUID();
    const email = (
      await prisma.user.findUniqueOrThrow({ where: { id: target.id } })
    ).email;
    const kitchen = await signInWith(
      { email, password: PASSWORD },
      { deviceId },
    );
    expect(kitchen.status).toBe(200);
    await prisma.screenChoice.create({
      data: { userId: target.id, deviceId, screen: "KITCHEN" },
    });
    await prisma.session.create({
      data: {
        token: `${PREFIX}expired-${crypto.randomUUID()}`,
        userId: target.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const listed = await admin.caller.household.memberSessions({
      userId: target.id,
    });

    const rowsOf = await prisma.session.findMany({
      where: { userId: target.id, expiresAt: { gt: new Date() } },
      select: { id: true, token: true },
    });
    expect(listed.map((row) => row.id).toSorted()).toEqual(
      rowsOf.map((row) => row.id).toSorted(),
    );
    expect(listed.some((row) => row.screen === "KITCHEN")).toBe(true);
    for (const row of listed) {
      // `current` too: none of these is the admin's.
      expect(Object.keys(row).toSorted()).toEqual([
        "device",
        "expiresAt",
        "id",
        "lastUsedAt",
        "remembered",
        "screen",
        "signedInAt",
      ]);
    }
    const text = JSON.stringify(listed);
    expect(text).not.toContain(deviceId);
    for (const row of rowsOf) expect(text).not.toContain(row.token);
  });

  it("answers another account's session id as not found, and ends nothing", async () => {
    // The id is scoped by the member's id in the delete itself: naming the
    // member and somebody else's session ends neither.
    const admin = await accountWithCaller("ADMIN", "Admin");
    const target = await accountWithCaller("MEMBER", "Named");
    const bystander = await accountWithCaller("MEMBER", "Bystander");
    const theirs = await readSession(bystander.browser, { refresh: false });
    if (!theirs) throw new Error("the bystander is not signed in");

    expect(
      await codeOf(
        admin.caller.household.endMemberSessions({
          userId: target.id,
          sessionId: theirs.sessionId,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(await signedIn(bystander)).toBe(true);
    expect(await signedIn(target)).toBe(true);
  });

  it("refuses a member from another household, and ends nothing", async () => {
    const admin = await accountWithCaller("ADMIN", "Admin");
    const stranger = await createTestHousehold({ name: `${PREFIX}Stranger` });
    const outsider = await accountWithCaller("MEMBER", "Outsider", stranger.id);

    expect(
      await codeOf(
        admin.caller.household.memberSessions({ userId: outsider.id }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await codeOf(
        admin.caller.household.endMemberSessions({ userId: outsider.id }),
      ),
    ).toBe("NOT_FOUND");
    expect(await signedIn(outsider)).toBe(true);
    expect(await rows(outsider.id)).toBe(1);
  });

  it("refuses an admin listing or ending an owner's", async () => {
    // The same guard as the rest of member management: an admin who could sign
    // an owner out could lock them out of answering.
    const admin = await accountWithCaller("ADMIN", "Admin");
    const owner = await accountWithCaller("OWNER", "Owner");
    const ownerSession = await readSession(owner.browser, { refresh: false });
    if (!ownerSession) throw new Error("the owner is not signed in");

    expect(
      await codeOf(admin.caller.household.memberSessions({ userId: owner.id })),
    ).toBe("FORBIDDEN");
    expect(
      await codeOf(
        admin.caller.household.endMemberSessions({ userId: owner.id }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await codeOf(
        admin.caller.household.endMemberSessions({
          userId: owner.id,
          sessionId: ownerSession.sessionId,
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(await signedIn(owner)).toBe(true);
  });

  it("refuses a member who is not an admin, and ends nothing", async () => {
    const member = await accountWithCaller("MEMBER", "NotAdmin");
    const target = await accountWithCaller("KITCHEN", "Kept");

    expect(
      await codeOf(
        member.caller.household.memberSessions({ userId: target.id }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await codeOf(
        member.caller.household.endMemberSessions({ userId: target.id }),
      ),
    ).toBe("FORBIDDEN");
    expect(await signedIn(target)).toBe(true);
  });

  it("refuses the caller's own id: their own sessions end behind their password", async () => {
    // An admin session that could end its own account's sessions here would
    // be the way round `auth.endSessions`' password for whoever holds it.
    const sole = await accountWithCaller("OWNER", "Sole");

    expect(
      await codeOf(sole.caller.household.memberSessions({ userId: sole.id })),
    ).toBe("BAD_REQUEST");
    expect(
      await codeOf(
        sole.caller.household.endMemberSessions({ userId: sole.id }),
      ),
    ).toBe("BAD_REQUEST");
    expect(await signedIn(sole)).toBe(true);
  });

  it("lets an owner end another owner's", async () => {
    // Deliberately no last-owner guard here. Ending sessions changes nothing
    // about who owns the household.
    const owner = await accountWithCaller("OWNER", "First");
    const other = await accountWithCaller("OWNER", "Second");

    await owner.caller.household.endMemberSessions({ userId: other.id });

    expect(await signedIn(other)).toBe(false);
    expect(await signedIn(owner)).toBe(true);
  });
});

/**
 * An owner ending every session in the household, their own included, after
 * their password (`household.endHouseholdSessions`; ASVS 5.0.0 7.4.5,
 * PROGRESS D147). The reach is the point: everybody in this household, the
 * owners too, and nobody outside it.
 */
describe("an owner ending every session in the household", () => {
  const WRONG_PASSWORD = "no es la contraseña";
  const endHousehold = (account: Account, currentPassword = PASSWORD) =>
    account.caller.household.endHouseholdSessions({ currentPassword });

  it("ends everybody's in this household, the owners' included, and nobody else's", async () => {
    const owner = await accountWithCaller("OWNER", "HouseOwner");
    const coOwner = await accountWithCaller("OWNER", "HouseCoOwner");
    const admin = await accountWithCaller("ADMIN", "HouseAdmin");
    const kitchen = await accountWithCaller("KITCHEN", "HouseKitchen");
    const elsewhere = await createTestHousehold({ name: `${PREFIX}Elsewhere` });
    const outsider = await accountWithCaller("OWNER", "Outsider", elsewhere.id);
    const house = [owner, coOwner, admin, kitchen];
    // The control: every cookie works before.
    expect(await Promise.all([...house, outsider].map(signedIn))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);

    let answer: unknown;
    const events = await eventsDuring(async () => {
      answer = await endHousehold(owner);
    });

    expect(answer).toEqual({ ended: 4 });
    expect(await Promise.all(house.map(signedIn))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(await Promise.all(house.map((account) => rows(account.id)))).toEqual(
      [0, 0, 0, 0],
    );
    expect(await signedIn(outsider)).toBe(true);
    expect(await rows(outsider.id)).toBe(1);
    // One line for the lot: who asked, which household, how many — and no
    // target, because they were everybody's.
    const ended = events.filter(
      (event) => event.event === "auth.session.ended",
    );
    expect(ended).toEqual([
      expect.objectContaining({
        userId: owner.id,
        householdId,
        reason: "owner",
        count: "4",
      }),
    ]);
    expect(ended[0]).not.toHaveProperty("targetUserId");
  });

  it("refuses an admin, a member and a kitchen account before asking for the password, and ends nothing", async () => {
    // An admin may not reach an owner's sessions one at a time (D145), so not
    // all at once either. Refused before the password, so a wrong one is not
    // even recorded: the question is never asked.
    const owner = await accountWithCaller("OWNER", "KeptOwner");
    const others = [
      await accountWithCaller("ADMIN", "NotOwnerAdmin"),
      await accountWithCaller("MEMBER", "NotOwnerMember"),
      await accountWithCaller("KITCHEN", "NotOwnerKitchen"),
    ];

    const codes: (string | null)[] = [];
    const events = await eventsDuring(async () => {
      for (const account of others)
        codes.push(await codeOf(endHousehold(account)));
      codes.push(
        await codeOf(endHousehold(others[0] as Account, WRONG_PASSWORD)),
      );
    });

    expect(codes).toEqual(["FORBIDDEN", "FORBIDDEN", "FORBIDDEN", "FORBIDDEN"]);
    expect(await Promise.all([owner, ...others].map(signedIn))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(events.some((event) => event.event === "auth.session.ended")).toBe(
      false,
    );
    expect(events.some((event) => event.event === "auth.reauth.refused")).toBe(
      false,
    );
  });

  it("refuses a wrong password, ends nothing, and records it", async () => {
    const owner = await accountWithCaller("OWNER", "WrongOwner");
    const member = await accountWithCaller("MEMBER", "WrongMember");

    let code = null as string | null;
    const events = await eventsDuring(async () => {
      code = await codeOf(endHousehold(owner, WRONG_PASSWORD));
    });

    expect(code).toBe("BAD_REQUEST");
    expect([await signedIn(owner), await signedIn(member)]).toEqual([
      true,
      true,
    ]);
    expect(
      events.filter((event) => event.event === "auth.reauth.refused"),
    ).toEqual([
      expect.objectContaining({ userId: owner.id, via: "household-end-all" }),
    ]);
    expect(events.some((event) => event.event === "auth.session.ended")).toBe(
      false,
    );
  });
});

/**
 * A person's own sessions, listed and ended after the current password
 * (`auth.listSessions`, `auth.endSessions`; ASVS 5.0.0 7.5.2, PROGRESS D143).
 *
 * Every session here is a real sign-in, and every caller runs on the session
 * one of them got — read back with `readSession`, as the tRPC route does —
 * because "this session", "the others" and "the per-session budget" all mean
 * the row a real cookie names.
 */

const WRONG = "no es la contraseña";
const FIREFOX_ANDROID =
  "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";

interface Device {
  /** What the browser sends: the session cookie, and `stoky_device` when it has one. */
  headers: Headers;
  sessionId: string;
}

interface Person {
  id: string;
  email: string;
}

async function person(label: string): Promise<Person> {
  const email = generateTestEmail(`own-${label.toLowerCase()}`);
  const user = await createTestUser({
    email,
    name: `${PREFIX}${label}`,
    password: PASSWORD,
    householdId,
    role: "MEMBER",
  });
  return { id: user.id, email };
}

async function signInDevice(
  who: Person,
  options: { deviceId?: string; userAgent?: string } = {},
): Promise<Device> {
  const outcome = await signInWith(
    { email: who.email, password: PASSWORD },
    options,
  );
  expect(outcome.status).toBe(200);
  const cookie = [
    options.deviceId ? `stoky_device=${options.deviceId}` : "",
    outcome.cookieHeader,
  ]
    .filter(Boolean)
    .join("; ");
  const headers = new Headers({ cookie });
  const session = await readSession(headers, { refresh: false });
  if (!session) throw new Error("the sign-in left no session to read");
  return { headers, sessionId: session.sessionId };
}

/** A caller on `device`'s own session, as the tRPC route builds one. */
async function callerOn(device: Device): Promise<Caller> {
  const session = await readSession(device.headers, { refresh: false });
  if (!session) throw new Error("that device is signed out");
  const ctx = await createTRPCContext({
    session,
    headers: new Headers({ "x-forwarded-for": "203.0.113.21" }),
  });
  return appRouter.createCaller(ctx);
}

const alive = async (device: Device) =>
  (await readSession(device.headers, { refresh: false })) !== null;

describe("a person's own sessions", () => {
  it("lists each live one by device, with no token and no device id", async () => {
    const me = await person("Lists");
    const deviceId = crypto.randomUUID();
    const kitchen = await signInDevice(me, {
      deviceId,
      userAgent: FIREFOX_ANDROID,
    });
    const laptop = await signInDevice(me);
    await prisma.screenChoice.create({
      data: { userId: me.id, deviceId, screen: "KITCHEN" },
    });
    // An expired row is a session that has ended; it is not listed.
    const expired = await prisma.session.create({
      data: {
        token: `${PREFIX}expired-${crypto.randomUUID()}`,
        userId: me.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const listed = await (await callerOn(laptop)).auth.listSessions();

    expect(listed.map((row) => row.id).toSorted()).toEqual(
      [kitchen.sessionId, laptop.sessionId].toSorted(),
    );
    expect(listed.map((row) => row.id)).not.toContain(expired.id);
    const tablet = listed.find((row) => row.id === kitchen.sessionId);
    expect(tablet).toMatchObject({
      device: { browser: "Firefox", os: "Android" },
      screen: "KITCHEN",
      remembered: false,
      current: false,
    });
    expect(listed.find((row) => row.id === laptop.sessionId)).toMatchObject({
      current: true,
      screen: null,
    });
    for (const row of listed) {
      expect(Object.keys(row).toSorted()).toEqual([
        "current",
        "device",
        "expiresAt",
        "id",
        "lastUsedAt",
        "remembered",
        "screen",
        "signedInAt",
      ]);
      expect(JSON.stringify(row)).not.toContain(deviceId);
    }
    // And the row really holds it: the join above is not a coincidence.
    expect(
      (
        await prisma.session.findUniqueOrThrow({
          where: { id: kitchen.sessionId },
        })
      ).deviceId,
    ).toBe(deviceId);
  });

  it("names a device by this account's screen choice, never another account's on it", async () => {
    // A shared tablet: another person chose a screen on it, this one did not.
    const me = await person("SharedTablet");
    const other = await person("OtherOnTablet");
    const deviceId = crypto.randomUUID();
    const tablet = await signInDevice(me, { deviceId });
    await prisma.screenChoice.create({
      data: { userId: other.id, deviceId, screen: "SHOPPING" },
    });

    const listed = await (await callerOn(tablet)).auth.listSessions();

    expect(listed).toEqual([
      expect.objectContaining({ id: tablet.sessionId, screen: null }),
    ]);
  });

  it("never hands the device id to the browser that signed in", async () => {
    // `returned: false`: Better Auth's own answers leave it out, the sign-in's
    // and get-session's alike.
    const me = await person("Hidden");
    const deviceId = crypto.randomUUID();
    const outcome = await signInWith(
      { email: me.email, password: PASSWORD },
      { deviceId },
    );

    expect(outcome.status).toBe(200);
    expect(JSON.stringify(outcome.body)).not.toContain(deviceId);
    const { GET } = await import("@/app/api/auth/[...all]/route");
    const read = await GET(
      new Request(`${testOrigin()}/api/auth/get-session`, {
        headers: {
          cookie: `stoky_device=${deviceId}; ${outcome.cookieHeader}`,
        },
      }),
    );
    const text = await read.text();
    expect(text).toContain(me.id);
    expect(text).not.toContain(deviceId);
    expect(text).not.toContain("deviceId");
  });

  it("ends one, by id, and nothing else", async () => {
    const me = await person("One");
    const [here, phone, tablet] = [
      await signInDevice(me),
      await signInDevice(me),
      await signInDevice(me),
    ];

    const answer = await (
      await callerOn(here)
    ).auth.endSessions({
      currentPassword: PASSWORD,
      scope: "one",
      sessionId: phone.sessionId,
    });

    expect(answer).toEqual({ ended: 1, includedCurrent: false });
    expect([
      await alive(here),
      await alive(phone),
      await alive(tablet),
    ]).toEqual([true, false, true]);
  });

  it("ends every other one, and keeps the one asking", async () => {
    const me = await person("Others");
    const someoneElse = await person("Bystander");
    const [here, phone, tablet] = [
      await signInDevice(me),
      await signInDevice(me),
      await signInDevice(me),
    ];
    const theirs = await signInDevice(someoneElse);

    const answer = await (
      await callerOn(here)
    ).auth.endSessions({
      currentPassword: PASSWORD,
      scope: "others",
    });

    expect(answer).toEqual({ ended: 2, includedCurrent: false });
    expect([
      await alive(here),
      await alive(phone),
      await alive(tablet),
    ]).toEqual([true, false, false]);
    expect(await alive(theirs)).toBe(true);
  });

  it("ends every one, the one asking included, and says so", async () => {
    const me = await person("All");
    const someoneElse = await person("Untouched");
    const [here, phone] = [await signInDevice(me), await signInDevice(me)];
    const theirs = await signInDevice(someoneElse);

    let answer: unknown;
    const events = await eventsDuring(async () => {
      answer = await (
        await callerOn(here)
      ).auth.endSessions({ currentPassword: PASSWORD, scope: "all" });
    });

    expect(answer).toEqual({ ended: 2, includedCurrent: true });
    expect([await alive(here), await alive(phone)]).toEqual([false, false]);
    expect(await rows(me.id)).toBe(0);
    expect(await alive(theirs)).toBe(true);
    expect(
      events.filter((event) => event.event === "auth.session.ended"),
    ).toEqual([
      expect.objectContaining({
        userId: me.id,
        targetUserId: me.id,
        reason: "self",
        count: "2",
      }),
    ]);
  });

  it("answers this session's own id, ended alone, as including the current one", async () => {
    const me = await person("Self");
    const here = await signInDevice(me);

    expect(
      await (
        await callerOn(here)
      ).auth.endSessions({
        currentPassword: PASSWORD,
        scope: "one",
        sessionId: here.sessionId,
      }),
    ).toEqual({ ended: 1, includedCurrent: true });
    expect(await alive(here)).toBe(false);
  });

  it("refuses a wrong password, ends nothing, and records it", async () => {
    const me = await person("Wrong");
    const [here, phone] = [await signInDevice(me), await signInDevice(me)];
    const caller = await callerOn(here);

    let code = null as string | null;
    const events = await eventsDuring(async () => {
      code = await codeOf(
        caller.auth.endSessions({ currentPassword: WRONG, scope: "others" }),
      );
    });

    expect(code).toBe("BAD_REQUEST");
    expect([await alive(here), await alive(phone)]).toEqual([true, true]);
    expect(
      events.filter((event) => event.event === "auth.reauth.refused"),
    ).toEqual([
      expect.objectContaining({
        userId: me.id,
        via: "end-sessions",
        address: "203.0.113.21",
      }),
    ]);
    expect(events.some((event) => event.event === "auth.session.ended")).toBe(
      false,
    );
  });

  it("counts wrong passwords against the session, and refuses the sixth before checking it", async () => {
    const me = await person("Counted");
    const here = await signInDevice(me);
    const caller = await callerOn(here);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(
        await codeOf(
          caller.auth.endSessions({ currentPassword: WRONG, scope: "others" }),
        ),
      ).toBe("BAD_REQUEST");
    }
    // The right password now, and still refused: the budget is spent.
    expect(
      await codeOf(
        caller.auth.endSessions({ currentPassword: PASSWORD, scope: "others" }),
      ),
    ).toBe("TOO_MANY_REQUESTS");
  });

  it("gives a right answer's attempt back, so confirming again and again is never refused", async () => {
    const me = await person("Refunded");
    const here = await signInDevice(me);
    const caller = await callerOn(here);

    expect(
      await codeOf(
        caller.auth.endSessions({ currentPassword: WRONG, scope: "others" }),
      ),
    ).toBe("BAD_REQUEST");
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      expect(
        await codeOf(
          caller.auth.endSessions({
            currentPassword: PASSWORD,
            scope: "others",
          }),
        ),
      ).toBeNull();
    }
  });

  it("leaves another session of the account able to confirm after one has spent its budget", async () => {
    // The point of counting per session: the owner, on their own session,
    // can still end the one somebody else is guessing from.
    const me = await person("Evicts");
    const stolen = await signInDevice(me);
    const owner = await signInDevice(me);
    const thief = await callerOn(stolen);

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await codeOf(
        thief.auth.endSessions({ currentPassword: WRONG, scope: "others" }),
      );
    }
    expect(
      await codeOf(
        thief.auth.endSessions({ currentPassword: PASSWORD, scope: "others" }),
      ),
    ).toBe("TOO_MANY_REQUESTS");

    expect(
      await (
        await callerOn(owner)
      ).auth.endSessions({
        currentPassword: PASSWORD,
        scope: "one",
        sessionId: stolen.sessionId,
      }),
    ).toEqual({ ended: 1, includedCurrent: false });
    expect(await alive(stolen)).toBe(false);
    expect(await alive(owner)).toBe(true);
  });

  it("stops guessing spread over many sessions at the account's twenty", async () => {
    // The backstop: ten sessions are not ten budgets of five.
    const me = await person("Spread");
    const devices = [];
    for (let i = 0; i < 5; i += 1) devices.push(await signInDevice(me));
    for (const device of devices.slice(0, 4)) {
      const caller = await callerOn(device);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect(
          await codeOf(
            caller.auth.endSessions({
              currentPassword: WRONG,
              scope: "others",
            }),
          ),
        ).toBe("BAD_REQUEST");
      }
    }

    // A fifth session's own budget is untouched; the account's is spent.
    expect(
      await codeOf(
        (await callerOn(devices[4])).auth.endSessions({
          currentPassword: PASSWORD,
          scope: "others",
        }),
      ),
    ).toBe("TOO_MANY_REQUESTS");
    expect(await rows(me.id)).toBe(5);
  });

  it("keeps a right answer counted against the account, so the owner cannot refill it", async () => {
    // Only the per-session charge is given back. Were the account's refunded
    // too, the owner's own confirmations would hand the thief more guesses.
    const me = await person("Backstop");
    const devices = [];
    for (let i = 0; i < 5; i += 1) devices.push(await signInDevice(me));
    for (const [index, device] of devices.slice(0, 4).entries()) {
      const caller = await callerOn(device);
      for (let attempt = 1; attempt <= (index === 3 ? 4 : 5); attempt += 1) {
        expect(
          await codeOf(
            caller.auth.endSessions({
              currentPassword: WRONG,
              scope: "others",
            }),
          ),
        ).toBe("BAD_REQUEST");
      }
    }

    // Nineteen wrong; the owner's right answer is the twentieth, and allowed.
    const owner = await callerOn(devices[4]);
    expect(
      await codeOf(
        owner.auth.endSessions({ currentPassword: PASSWORD, scope: "others" }),
      ),
    ).toBeNull();
    // Its session's attempt came back; the account's did not.
    expect(
      await codeOf(
        owner.auth.endSessions({ currentPassword: PASSWORD, scope: "others" }),
      ),
    ).toBe("TOO_MANY_REQUESTS");
  });

  it("answers another account's session id as not found, and ends nothing", async () => {
    const me = await person("Prober");
    const other = await person("Probed");
    const here = await signInDevice(me);
    const theirs = await signInDevice(other);

    expect(
      await codeOf(
        (await callerOn(here)).auth.endSessions({
          currentPassword: PASSWORD,
          scope: "one",
          sessionId: theirs.sessionId,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(await alive(theirs)).toBe(true);
    expect(await alive(here)).toBe(true);
  });

  it("refuses 'every other' from a context that names no session, before asking anything", async () => {
    // Prisma reads `{ id: { not: undefined } }` as no condition: without the
    // refusal, "every other" would be every one.
    const me = await person("Nameless");
    const [phone, tablet] = [await signInDevice(me), await signInDevice(me)];
    const session = await readSession(phone.headers, { refresh: false });
    if (!session) throw new Error("unreachable");
    const nameless = { ...session, sessionId: undefined as unknown as string };
    const caller = appRouter.createCaller(
      await createTRPCContext({ session: nameless }),
    );

    expect(
      await codeOf(
        caller.auth.endSessions({ currentPassword: PASSWORD, scope: "others" }),
      ),
    ).toBe("BAD_REQUEST");
    expect([await alive(phone), await alive(tablet)]).toEqual([true, true]);
  });
});
