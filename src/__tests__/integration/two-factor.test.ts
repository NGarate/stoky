import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { symmetricDecrypt } from "better-auth/crypto";
import { POST } from "@/app/api/auth/[...all]/route";
import { readSession } from "@/lib/auth";
import { BACKUP_CODE_HASH_PREFIX, generateBackupCodes, normaliseBackupCode } from "@/lib/auth/backup-codes";
import { getAuth } from "@/lib/auth/instance";
import { NO_MATCH_CODE, hotp, totpClock, totpStep } from "@/lib/auth/policy-plugin";
import { MAX_SESSIONS_PER_ACCOUNT } from "@/lib/auth/session-policy";
import { prisma } from "@/lib/prisma";
import { accountIdentifier, loginAccountRateLimit, resetRateLimit } from "@/lib/rate-limit";
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
 * Two-step verification with an authenticator app (PROGRESS D148), through
 * the real auth route, Better Auth's two-factor plugin, the replay guard
 * (`src/lib/auth/policy-plugin.ts`) and the rows.
 *
 * Most tests enrol through `getAuth().api` with a signed-in browser's cookie,
 * the shortest way to an account that has it; enrolling through the route, as
 * the settings screen does, is the last describe's subject. Everything after
 * it — the password step, the code — is what a browser sends to `/api/auth/*`.
 *
 * **Codes.** Every code here is made with the guard's own `hotp` from the
 * secret Better Auth stored, and every code Better Auth accepts proves the two
 * agree. Enrolling claims the step it ran in, so a sign-in afterwards uses the
 * next step's code (`code(person, 1)`), which Better Auth's ±1 window
 * accepts; one account per test keeps the steps from crossing tests.
 */

const PASSWORD = "cocina despensa nevera";
const MARKER = `twofa-${process.pid}-${Date.now().toString(36)}`;
const SESSION_COOKIE = "stoky.session_token";
const CHALLENGE_COOKIE = "stoky.two_factor";

afterEach(() => {
  totpClock.now = () => Date.now();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: MARKER } } });
  await prisma.household.deleteMany({ where: { name: { contains: MARKER } } });
});

interface Person {
  id: string;
  email: string;
  /** The authenticator secret, as the app holds it. */
  secret: string;
  /** The browser that enrolled, still signed in. */
  jar: string;
  /** The recovery codes enrolment showed, in the clear. */
  backupCodes: string[];
}

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
    if (/;\s*max-age=0\b/i.test(line) || pair.endsWith("=")) cookies.delete(name);
    else cookies.set(name, pair);
  }
  return [...cookies.values()].join("; ");
}

/** The code the app shows `steps` steps from now. */
function code(person: Pick<Person, "secret">, steps = 0): string {
  return hotp(person.secret, totpStep(Date.now()) + steps);
}

/** Six digits that are no code of this secret's anywhere near now. */
function wrongCode(person: Pick<Person, "secret">): string {
  const near = new Set([-2, -1, 0, 1, 2].map((steps) => code(person, steps)));
  for (let n = 0; ; n += 1) {
    const candidate = String(n).padStart(6, "0");
    if (!near.has(candidate)) return candidate;
  }
}

async function account(label: string, householdId?: string, role?: "OWNER" | "MEMBER") {
  const email = generateTestEmail(`${MARKER}-${label}`);
  const user = await createTestUser({ email, name: `Two ${label}`, password: PASSWORD, householdId, role });
  return { id: user.id, email };
}

/** An account with an authenticator enrolled from a browser that stays signed in. */
async function enrolled(label: string, householdId?: string): Promise<Person> {
  const { id, email } = await account(label, householdId);
  const signedIn = await signInWith({ email, password: PASSWORD });
  expect(signedIn.status).toBe(200);
  let jar = signedIn.cookieHeader;

  const auth = getAuth();
  const enabled = await auth.api.enableTwoFactor({
    body: { password: PASSWORD },
    headers: new Headers({ cookie: jar }),
  });
  if (enabled.method !== "totp") throw new Error("enrolment did not set up an authenticator");
  const row = await prisma.twoFactor.findUniqueOrThrow({ where: { userId: id } });
  const secret = await symmetricDecrypt({ key: (await auth.$context).secretConfig, data: row.secret });

  // The first code from the new authenticator turns it on, and re-creates
  // the browser's session.
  const verified = await auth.api.verifyTOTP({
    body: { code: code({ secret }) },
    headers: new Headers({ cookie: jar }),
    asResponse: true,
  });
  expect(verified.status).toBe(200);
  jar = mergeJar(jar, verified.headers.getSetCookie());
  expect((await prisma.user.findUniqueOrThrow({ where: { id } })).twoFactorEnabled).toBe(true);

  return { id, email, secret, jar, backupCodes: enabled.backupCodes };
}

/** A browser's password step; `jar` is what it already holds. */
async function passwordStep(
  person: Pick<Person, "email">,
  options: { rememberMe?: boolean; jar?: string; password?: string } = {},
) {
  const answer = await signInWith(
    { email: person.email, password: options.password ?? PASSWORD, rememberMe: options.rememberMe },
    { cookie: options.jar },
  );
  return { ...answer, jar: options.jar ? mergeJar(options.jar, answer.setCookie) : answer.cookieHeader };
}

/** A password step that must stop for the code; returns the browser's jar. */
async function challenge(
  person: Pick<Person, "email">,
  options: { rememberMe?: boolean; jar?: string } = {},
): Promise<string> {
  const answer = await passwordStep(person, options);
  expect(answer.status).toBe(200);
  expect(answer.body).toMatchObject({ twoFactorRedirect: true });
  expect(answer.jar).toContain(`${CHALLENGE_COOKIE}=`);
  return answer.jar;
}

/** A second step through the route, as the login form will send it. */
async function secondStep(
  kind: "totp" | "backup-code",
  jar: string,
  body: Record<string, unknown>,
  address = freshTestAddress(),
) {
  const response = await POST(
    new Request(`${testOrigin()}/api/auth/two-factor/verify-${kind}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: jar,
        origin: testOrigin(),
        "x-forwarded-for": address,
      },
      body: JSON.stringify(body),
    }),
  );
  const setCookie = response.headers.getSetCookie();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  return {
    status: response.status,
    code: typeof parsed?.code === "string" ? parsed.code : undefined,
    body: parsed,
    setCookie,
    retryAfter: response.headers.get("retry-after"),
    jar: mergeJar(jar, setCookie),
  };
}

const signedInAs = async (jar: string) =>
  (await readSession(new Headers({ cookie: jar }), { refresh: false }))?.user.id ?? null;

const twoFactorRow = (userId: string) => prisma.twoFactor.findUniqueOrThrow({ where: { userId } });

/** The security events written while `run` ran, parsed; every value a string. */
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

describe("a sign-in with two-step verification", () => {
  it("stops at the password for the code, and the code signs in", async () => {
    const ana = await enrolled("works");
    const sessionsBefore = await prisma.session.count({ where: { userId: ana.id } });

    let jar = "";
    const step = await eventsDuring(async () => {
      jar = await challenge(ana);
    });
    // The password alone is no session: none for the browser, no row left.
    expect(await signedInAs(jar)).toBeNull();
    expect(jar).not.toContain(`${SESSION_COOKIE}=`);
    expect(await prisma.session.count({ where: { userId: ana.id } })).toBe(sessionsBefore);
    expect(step.events.map((line) => line.event)).toContain("auth.signin.challenged");
    expect(step.events.map((line) => line.event)).not.toContain("auth.signin.succeeded");

    let answer: Awaited<ReturnType<typeof secondStep>> | undefined;
    const second = await eventsDuring(async () => {
      answer = await secondStep("totp", jar, { code: code(ana, 1) });
    });
    expect(answer?.status).toBe(200);
    expect(await signedInAs(answer?.jar ?? "")).toBe(ana.id);
    // The challenge is spent with it.
    expect(answer?.jar).not.toContain(`${CHALLENGE_COOKIE}=`);
    expect(second.events.find((line) => line.event === "auth.signin.succeeded")).toMatchObject({
      userId: ana.id,
      method: "totp",
    });
    // The page is never handed the raw token, and the log never the code,
    // the secret or the address typed.
    expect(answer?.body).not.toHaveProperty("token");
    for (const secret of [ana.secret, code(ana, 1), ana.email]) {
      expect(step.raw + second.raw).not.toContain(secret);
    }
  });
});

describe("a code works once (ASVS 5.0.0 6.5.1)", () => {
  it("refuses a code already used for another sign-in in the same step", async () => {
    const ana = await enrolled("replay");
    const first = await challenge(ana);
    const second = await challenge(ana);
    const used = code(ana, 1);

    expect((await secondStep("totp", first, { code: used })).status).toBe(200);
    let answer: Awaited<ReturnType<typeof secondStep>> | undefined;
    const { events } = await eventsDuring(async () => {
      answer = await secondStep("totp", second, { code: used });
    });

    expect(answer?.status).toBe(401);
    expect(answer?.code).toBe("INVALID_CODE");
    expect(await signedInAs(answer?.jar ?? "")).toBeNull();
    expect(events.find((line) => line.event === "auth.twofactor.replayed")).toMatchObject({
      userId: ana.id,
    });
  });

  it("refuses an earlier step's code once a later one has been used", async () => {
    const ana = await enrolled("earlier");
    const first = await challenge(ana);
    const second = await challenge(ana);

    expect((await secondStep("totp", first, { code: code(ana, 1) })).status).toBe(200);
    const answer = await secondStep("totp", second, { code: code(ana, 0) });

    expect(answer.status).toBe(401);
    expect(answer.code).toBe("INVALID_CODE");
  });

  it("lets exactly one of two simultaneous sign-ins with one code through", async () => {
    // Two requests in flight together are not enough to show it: in-process
    // they reach the claim one after the other. So the row is held locked
    // while both get there. Each has read the counter by then, and each
    // UPDATE waits for the lock; when it goes, the first claims the step and
    // the second's must find it claimed. A check made by reading first
    // would have let both through.
    const ana = await enrolled("race");
    const jars = [await challenge(ana), await challenge(ana)];
    const step = totpStep(Date.now()) + 1;
    const used = hotp(ana.secret, step);

    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "TwoFactor" WHERE "userId" = ${ana.id} FOR UPDATE`;
        locked();
        await released;
      },
      { timeout: 15_000 },
    );
    await isLocked;
    const answering = Promise.all(jars.map((jar) => secondStep("totp", jar, { code: used })));
    // Long enough for both to read and reach the claim, which then waits.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    release();
    await holder;
    const answers = await answering;

    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 401]);
    expect((await twoFactorRow(ana.id)).lastTotpCounter).toBe(step);
  });

  it("counts the code that turned the authenticator on as used", async () => {
    const enrolledAt = Date.now();
    const ana = await enrolled("enrolment");
    const enrolmentCode = hotp(ana.secret, totpStep(enrolledAt));

    const answer = await secondStep("totp", await challenge(ana), { code: enrolmentCode });

    expect(answer.status).toBe(401);
    expect(answer.code).toBe("INVALID_CODE");
  });

  it("counts the enrolment code as used when a bearer token turned the authenticator on", async () => {
    // A native client's request carries the token, not the cookie, and
    // Better Auth gives the guard the request before the bearer plugin turns
    // one into the other: read from there it had no session and no
    // challenge, stood aside, and the code was never claimed — a web
    // sign-in's second step then took it again.
    const { id, email } = await account("bearer-enrolment");
    const native = await signInWith({ email, password: PASSWORD });
    const token = native.headers.get("set-auth-token");
    if (!token) throw new Error("a native sign-in was given no set-auth-token");
    const bearer = () => new Headers({ authorization: `Bearer ${token}` });

    const auth = getAuth();
    await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: bearer() });
    const secret = await symmetricDecrypt({
      key: (await auth.$context).secretConfig,
      data: (await twoFactorRow(id)).secret,
    });
    const step = totpStep(Date.now());
    const enrolmentCode = hotp(secret, step);
    const verified = await auth.api.verifyTOTP({
      body: { code: enrolmentCode },
      headers: bearer(),
      asResponse: true,
    });
    expect(verified.status).toBe(200);
    expect((await twoFactorRow(id)).lastTotpCounter).toBe(step);

    const answer = await secondStep("totp", await challenge({ email }), { code: enrolmentCode });
    expect(answer.status).toBe(401);
    expect(answer.code).toBe("INVALID_CODE");
  });

  it("does not let a code through unclaimed when the clock crosses a step mid-request", async () => {
    // The guard and Better Auth each read the clock. Here the guard's runs
    // two steps behind, so the code for now is, to the guard, two steps
    // ahead: no step of its own. Better Auth would accept it; the guard must
    // make it fail rather than pass it on unclaimed.
    const ana = await enrolled("clock");
    const jar = await challenge(ana);
    const before = (await twoFactorRow(ana.id)).lastTotpCounter;
    totpClock.now = () => Date.now() - 60_000;

    const answer = await secondStep("totp", jar, { code: code(ana, 0) });

    expect(answer.status).toBe(401);
    expect(answer.code).toBe("INVALID_CODE");
    expect((await twoFactorRow(ana.id)).lastTotpCounter).toBe(before);
  });
});

describe("wrong codes", () => {
  it("end the challenge after five, and count against the account", async () => {
    const ana = await enrolled("five");
    const jar = await challenge(ana);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const answer = await secondStep("totp", jar, { code: wrongCode(ana) });
      expect(answer.status, `attempt ${attempt + 1}`).toBe(401);
      expect(answer.code).toBe("INVALID_CODE");
    }
    // Even the right code: the challenge is over, and only the password
    // starts another.
    const after = await secondStep("totp", jar, { code: code(ana, 1) });

    expect(after.status).toBe(400);
    expect(after.code).toBe("TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE");
    expect(await signedInAs(after.jar)).toBeNull();
    expect((await twoFactorRow(ana.id)).failedVerificationCount).toBe(5);
    // The guard's replacement is what Better Auth was given and refused.
    expect(NO_MATCH_CODE).not.toMatch(/^\d+$/);
  });
});

describe("a locked second step", () => {
  it("says when it may try again, from the lock's own end, for either kind of code", async () => {
    // Better Auth refuses a locked account's code 429 with no Retry-After;
    // every other spent budget here says how long.
    const ana = await enrolled("locked");
    await prisma.twoFactor.update({
      where: { userId: ana.id },
      data: { failedVerificationCount: 10, lockedUntil: new Date(Date.now() + 600_000) },
    });

    for (const [kind, body] of [
      ["totp", { code: code(ana, 1) }],
      ["backup-code", { code: ana.backupCodes[0] }],
    ] as const) {
      const answer = await secondStep(kind, await challenge(ana), body);
      expect(answer.status, kind).toBe(429);
      expect(answer.code, kind).toBe("ACCOUNT_TEMPORARILY_LOCKED");
      const seconds = Number(answer.retryAfter);
      expect(seconds, kind).toBeGreaterThan(590);
      expect(seconds, kind).toBeLessThanOrEqual(600);
    }
  });
});

describe("what the second step keeps from the first", () => {
  it("keeps an unticked box: a browser session, fifteen idle minutes", async () => {
    const ana = await enrolled("unticked");
    const answer = await secondStep("totp", await challenge(ana, { rememberMe: false }), {
      code: code(ana, 1),
    });
    expect(answer.status).toBe(200);

    const sessionLine = answer.setCookie.find((line) => line.startsWith(`${SESSION_COOKIE}=`));
    expect(sessionLine).toBeDefined();
    expect(sessionLine).not.toMatch(/max-age/i);
    const session = await readSession(new Headers({ cookie: answer.jar }), { refresh: false });
    const row = await prisma.session.findUniqueOrThrow({ where: { id: session?.sessionId } });
    expect(row.persistent).toBe(false);
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000 + 5_000);
  });

  it("keeps a ticked box: a remembered session", async () => {
    const ana = await enrolled("ticked");
    const answer = await secondStep("totp", await challenge(ana, { rememberMe: true }), {
      code: code(ana, 1),
    });
    expect(answer.status).toBe(200);

    const session = await readSession(new Headers({ cookie: answer.jar }), { refresh: false });
    const row = await prisma.session.findUniqueOrThrow({ where: { id: session?.sessionId } });
    expect(row.persistent).toBe(true);
    expect(answer.setCookie.find((line) => line.startsWith(`${SESSION_COOKIE}=`))).toMatch(/max-age/i);
  });
});

describe("what the route does not pass on", () => {
  it("ignores trustDevice: no cookie that would skip the code next time", async () => {
    const ana = await enrolled("trust");
    const answer = await secondStep("totp", await challenge(ana), {
      code: code(ana, 1),
      trustDevice: true,
    });

    expect(answer.status).toBe(200);
    expect(answer.setCookie.join("\n")).not.toContain("trust_device");
    expect(
      await prisma.verification.count({
        where: { identifier: { startsWith: "trust-device-" }, value: ana.id },
      }),
    ).toBe(0);
  });

  it("ignores disableSession: a backup code always ends in a session", async () => {
    const ana = await enrolled("backup");
    const answer = await secondStep("backup-code", await challenge(ana), {
      code: ana.backupCodes[0],
      disableSession: true,
    });

    expect(answer.status).toBe(200);
    expect(await signedInAs(answer.jar)).toBe(ana.id);
  });
});

describe("a challenge in progress ends with the account's sessions", () => {
  it("cannot be completed after an admin resets the password", async () => {
    const household = await createTestHousehold({ name: `Two ${MARKER}` });
    const owner = await account("owner", household.id, "OWNER");
    const ana = await enrolled("reset", household.id);
    const jar = await challenge(ana);

    const admin = appRouter.createCaller(
      await createTRPCContext({
        session: createMockSession(await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })),
      }),
    );
    await admin.household.resetMemberPassword({ userId: ana.id, newPassword: "tarro de garbanzos azul" });

    const answer = await secondStep("totp", jar, { code: code(ana, 1) });
    expect(answer.status).toBe(401);
    expect(answer.code).toBe("INVALID_TWO_FACTOR_COOKIE");
    expect(await prisma.verification.count({ where: { value: ana.id, identifier: { startsWith: "2fa-" } } })).toBe(0);
  });

  it("cannot be completed after the person changes their password elsewhere", async () => {
    const ana = await enrolled("change");
    const pending = await challenge(ana);

    const headers = new Headers({ cookie: ana.jar, "x-forwarded-for": "203.0.113.77" });
    const session = await readSession(headers, { refresh: false });
    if (!session) throw new Error("the enrolling browser is not signed in");
    const caller = appRouter.createCaller(await createTRPCContext({ session, headers }));
    await caller.auth.changePassword({ currentPassword: PASSWORD, newPassword: "tarro de garbanzos azul" });

    const answer = await secondStep("totp", pending, { code: code(ana, 1) });
    expect(answer.status).toBe(401);
    expect(answer.code).toBe("INVALID_TWO_FACTOR_COOKIE");
  });
});

describe("the sign-in budgets", () => {
  it("clear the account's counter when the password is right and the code is still to come", async () => {
    const ana = await enrolled("budget");
    const original = process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS;
    process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS = "3";
    try {
      await resetRateLimit(loginAccountRateLimit(), accountIdentifier(ana.email));
      for (let i = 0; i < 2; i += 1) {
        expect((await passwordStep(ana, { password: "no es la contraseña" })).status).toBe(401);
      }
      await challenge(ana);
      // Three more wrong passwords fit only if the right one cleared the two.
      for (let i = 0; i < 3; i += 1) {
        expect((await passwordStep(ana, { password: "no es la contraseña" })).status, `wrong ${i + 1}`).toBe(401);
      }
    } finally {
      await resetRateLimit(loginAccountRateLimit(), accountIdentifier(ana.email));
      if (original === undefined) delete process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS;
      else process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS = original;
    }
  });
});

describe("a secret this server can no longer read", () => {
  it("is refused as unreadable, uncounted and on the log", async () => {
    // What a rotated STOKY_SECRET leaves: an envelope for a key version the
    // instance does not hold.
    const ana = await enrolled("unreadable");
    const jar = await challenge(ana);
    await prisma.twoFactor.update({ where: { userId: ana.id }, data: { secret: "$ba$9$00ff" } });

    let answer: Awaited<ReturnType<typeof secondStep>> | undefined;
    const { events } = await eventsDuring(async () => {
      answer = await secondStep("totp", jar, { code: code(ana, 1) });
    });

    expect(answer?.status).toBe(401);
    expect(answer?.code).toBe("TWO_FACTOR_UNREADABLE");
    expect((await twoFactorRow(ana.id)).failedVerificationCount).toBe(0);
    expect(events.find((line) => line.event === "auth.twofactor.unreadable")).toMatchObject({
      userId: ana.id,
    });
  });
});

describe("the sessions a two-step sign-in ends", () => {
  it("ends the session of whoever the browser was signed in as at the password step", async () => {
    // A shared tablet signed in as Bea; Ana starts signing in on it. Better
    // Auth expires Bea's cookie in the answer that asks for the code, so her
    // row must go too, or a copy of the cookie would outlive the tablet's.
    const bea = await account("bea");
    const beaSignedIn = await signInWith({ email: bea.email, password: PASSWORD });
    expect(await signedInAs(beaSignedIn.cookieHeader)).toBe(bea.id);
    const ana = await enrolled("shared");

    const { events } = await eventsDuring(() => challenge(ana, { jar: beaSignedIn.cookieHeader }));

    expect(await prisma.session.count({ where: { userId: bea.id } })).toBe(0);
    expect(await signedInAs(beaSignedIn.cookieHeader)).toBeNull();
    expect(events.find((line) => line.event === "auth.session.ended")).toMatchObject({
      reason: "replaced",
      targetUserId: bea.id,
    });
  });

  it("holds the account to ten sessions, ending the least recently used", async () => {
    const ana = await enrolled("cap");
    for (let i = 0; i < MAX_SESSIONS_PER_ACCOUNT - 1; i += 1) {
      // Sessions opened the way this account opens them now: both steps.
      // Each claims a step, so the counter is put back between them; what is
      // under test here is the cap, not the single use.
      await prisma.twoFactor.update({ where: { userId: ana.id }, data: { lastTotpCounter: null } });
      expect((await secondStep("totp", await challenge(ana), { code: code(ana, 0) })).status).toBe(200);
    }
    const rows = await prisma.session.findMany({ where: { userId: ana.id }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(MAX_SESSIONS_PER_ACCOUNT);
    const leastUsed = rows[3];
    await prisma.session.update({
      where: { id: leastUsed.id },
      data: { updatedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    await prisma.twoFactor.update({ where: { userId: ana.id }, data: { lastTotpCounter: null } });
    const answer = await secondStep("totp", await challenge(ana), { code: code(ana, 0) });

    expect(answer.status).toBe(200);
    const left = await prisma.session.findMany({ where: { userId: ana.id }, select: { id: true } });
    expect(left).toHaveLength(MAX_SESSIONS_PER_ACCOUNT);
    expect(left.map((row) => row.id)).not.toContain(leastUsed.id);
  });
});

describe("backup codes (ASVS 5.0.0 6.5.2)", () => {
  /** The list as Better Auth stores it. */
  const storedCodes = async (userId: string) => JSON.parse((await twoFactorRow(userId)).backupCodes) as string[];

  /** How a person types a code off paper: lower case, spaces for dashes. */
  const typedCasually = (code: string) => code.toLowerCase().replaceAll("-", " ");

  it("are 120-bit codes stored as hashes: the column gives none of them back", async () => {
    const ana = await enrolled("hashed");

    expect(ana.backupCodes).toHaveLength(10);
    for (const issued of ana.backupCodes) {
      expect(issued).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
    }
    const raw = (await twoFactorRow(ana.id)).backupCodes;
    const stored = JSON.parse(raw) as string[];
    expect(stored).toHaveLength(10);
    for (const entry of stored) expect(entry).toMatch(/^sha256:[0-9a-f]{64}$/);
    for (const issued of ana.backupCodes) {
      expect(raw).not.toContain(issued);
      expect(raw).not.toContain(normaliseBackupCode(issued));
    }
  });

  it("work once, typed in lower case with spaces", async () => {
    const ana = await enrolled("once");
    const [spent, kept] = ana.backupCodes;

    const first = await secondStep("backup-code", await challenge(ana), { code: typedCasually(spent) });
    expect(first.status).toBe(200);
    expect(await signedInAs(first.jar)).toBe(ana.id);
    expect(await storedCodes(ana.id)).toHaveLength(9);

    const again = await secondStep("backup-code", await challenge(ana), { code: spent });
    expect(again.status).toBe(401);
    expect(again.code).toBe("INVALID_BACKUP_CODE");
    expect(await signedInAs(again.jar)).toBeNull();

    // The others still do; spending one rewrote the list without it alone.
    expect((await secondStep("backup-code", await challenge(ana), { code: kept })).status).toBe(200);
    const left = await storedCodes(ana.id);
    expect(left).toHaveLength(8);
    for (const entry of left) expect(entry.startsWith(BACKUP_CODE_HASH_PREFIX)).toBe(true);
  });

  it("refuse the stored hash typed as a code: reading the column is not a way in", async () => {
    const ana = await enrolled("column");
    const [hash] = await storedCodes(ana.id);

    const answer = await secondStep("backup-code", await challenge(ana), { code: hash });

    expect(answer.status).toBe(401);
    expect(answer.code).toBe("INVALID_BACKUP_CODE");
    expect(await storedCodes(ana.id)).toHaveLength(10);
  });

  it("are all replaced by a new set, and the old ones stop working", async () => {
    const ana = await enrolled("regenerate");
    const regenerated = await getAuth().api.generateBackupCodes({
      body: { password: PASSWORD },
      headers: new Headers({ cookie: ana.jar }),
    });
    expect(regenerated.backupCodes).toHaveLength(10);
    expect(regenerated.backupCodes).not.toContain(ana.backupCodes[0]);
    for (const entry of await storedCodes(ana.id)) expect(entry).toMatch(/^sha256:[0-9a-f]{64}$/);

    const old = await secondStep("backup-code", await challenge(ana), { code: ana.backupCodes[0] });
    expect(old.status).toBe(401);
    expect(old.code).toBe("INVALID_BACKUP_CODE");

    const fresh = await secondStep("backup-code", await challenge(ana), { code: regenerated.backupCodes[0] });
    expect(fresh.status).toBe(200);
    expect(await signedInAs(fresh.jar)).toBe(ana.id);
  });

  it("count a wrong one toward the account's lockout", async () => {
    const ana = await enrolled("wrong");
    // A well-formed code of the right length that was never issued to her.
    const [never] = generateBackupCodes();

    const answer = await secondStep("backup-code", await challenge(ana), { code: never });

    expect(answer.status).toBe(401);
    expect(answer.code).toBe("INVALID_BACKUP_CODE");
    expect((await twoFactorRow(ana.id)).failedVerificationCount).toBe(1);
  });

  it("still sign in once the authenticator is unreadable, and two-step verification can be set up again", async () => {
    // What a rotated STOKY_SECRET leaves: the TOTP secret in an envelope this
    // instance holds no key for. The backup codes involve no secret.
    const ana = await enrolled("rotated");
    await prisma.twoFactor.update({ where: { userId: ana.id }, data: { secret: "$ba$9$00ff" } });
    const jar = await challenge(ana);
    expect((await secondStep("totp", jar, { code: code(ana, 1) })).code).toBe("TWO_FACTOR_UNREADABLE");

    const answer = await secondStep("backup-code", jar, { code: ana.backupCodes[0] });
    expect(answer.status).toBe(200);
    expect(await signedInAs(answer.jar)).toBe(ana.id);

    // Then off and on again, which needs only the password: a new secret,
    // readable under this server's key, and a new set of codes.
    const auth = getAuth();
    const off = await auth.api.disableTwoFactor({
      body: { password: PASSWORD },
      headers: new Headers({ cookie: answer.jar }),
      asResponse: true,
    });
    expect(off.status).toBe(200);
    const signedIn = mergeJar(answer.jar, off.headers.getSetCookie());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ana.id } })).twoFactorEnabled).toBe(false);

    const on = await auth.api.enableTwoFactor({
      body: { password: PASSWORD },
      headers: new Headers({ cookie: signedIn }),
    });
    if (on.method !== "totp") throw new Error("enrolment did not set up an authenticator");
    expect(on.backupCodes).toHaveLength(10);
    const secret = await symmetricDecrypt({
      key: (await auth.$context).secretConfig,
      data: (await twoFactorRow(ana.id)).secret,
    });
    expect(secret).toHaveLength(32);
  });
});

/**
 * Setting it up from `/settings/security`: the three endpoints the route opens
 * for it (D148), each with the password, through the real route.
 */
describe("setting it up from the settings screen", () => {
  /** A change endpoint through the route, as the settings screen sends it. */
  async function change(path: string, jar: string, body: Record<string, unknown>) {
    const response = await POST(
      new Request(`${testOrigin()}/api/auth/two-factor/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: jar,
          origin: testOrigin(),
          "x-forwarded-for": freshTestAddress(),
        },
        body: JSON.stringify(body),
      }),
    );
    const setCookie = response.headers.getSetCookie();
    const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return {
      status: response.status,
      code: typeof parsed?.code === "string" ? parsed.code : undefined,
      body: parsed,
      retryAfter: response.headers.get("retry-after"),
      jar: mergeJar(jar, setCookie),
    };
  }

  /** A signed-in browser for a fresh account of `role`. */
  async function signedInBrowser(label: string, role: "KITCHEN" | "MEMBER" = "MEMBER") {
    const household = await createTestHousehold({ name: `${MARKER} ${label}` });
    const email = generateTestEmail(`${MARKER}-${label}`);
    const user = await createTestUser({ email, name: `Two ${label}`, password: PASSWORD, householdId: household.id, role });
    const signedIn = await signInWith({ email, password: PASSWORD });
    expect(signedIn.status).toBe(200);
    return { id: user.id, email, jar: signedIn.cookieHeader };
  }

  it("lets the kitchen's shared account turn it on, with the password and the first code", async () => {
    const kitchen = await signedInBrowser("set-kitchen", "KITCHEN");

    const enabled = await change("enable", kitchen.jar, { password: PASSWORD, issuer: "Otro" });
    expect(enabled.status).toBe(200);
    const uri = String(enabled.body?.totpURI);
    // The issuer the body named is not passed on: the app's entry says Stoky.
    expect(new URL(uri).searchParams.get("issuer")).toBe("Stoky");
    expect(enabled.body?.backupCodes).toHaveLength(10);
    // Nothing is on until the first code.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: kitchen.id } })).twoFactorEnabled).toBe(false);

    const secret = await symmetricDecrypt({
      key: (await getAuth().$context).secretConfig,
      data: (await twoFactorRow(kitchen.id)).secret,
    });
    let first: Awaited<ReturnType<typeof secondStep>> | undefined;
    const log = await eventsDuring(async () => {
      first = await secondStep("totp", enabled.jar, { code: code({ secret }) });
    });

    expect(first?.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: kitchen.id } })).twoFactorEnabled).toBe(true);
    // The browser that turned it on is still signed in, on its re-created session.
    expect(await signedInAs(first?.jar ?? "")).toBe(kitchen.id);
    expect(log.events.find((line) => line.event === "auth.twofactor.enabled")).toMatchObject({
      userId: kitchen.id,
    });
    // The next sign-in asks for a code.
    await challenge(kitchen);
  });

  it("logs a wrong password, and sets nothing up", async () => {
    const ana = await signedInBrowser("set-wrong");

    let refused: Awaited<ReturnType<typeof change>> | undefined;
    const log = await eventsDuring(async () => {
      refused = await change("enable", ana.jar, { password: "no es esta" });
    });

    expect(refused?.status).toBe(400);
    expect(refused?.code).toBe("INVALID_PASSWORD");
    expect(await prisma.twoFactor.count({ where: { userId: ana.id } })).toBe(0);
    expect(log.events.find((line) => line.event === "auth.reauth.refused")).toMatchObject({
      userId: ana.id,
      via: "two-factor",
    });
    expect(log.raw).not.toContain("no es esta");
  });

  it("stops a session guessing the password after five tries, the right one included", async () => {
    const ana = await signedInBrowser("set-budget");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await change("disable", ana.jar, { password: `no ${attempt}` })).code).toBe("INVALID_PASSWORD");
    }

    const sixth = await change("disable", ana.jar, { password: PASSWORD });

    expect(sixth.status).toBe(429);
    expect(sixth.code).toBe("REAUTH_RATE_LIMITED");
    expect(Number(sixth.retryAfter)).toBeGreaterThan(0);
  });

  it("turns it off with the password, and keeps the browser signed in", async () => {
    const ana = await enrolled("set-off");

    let off: Awaited<ReturnType<typeof change>> | undefined;
    const log = await eventsDuring(async () => {
      off = await change("disable", ana.jar, { password: PASSWORD });
    });

    expect(off?.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ana.id } })).twoFactorEnabled).toBe(false);
    expect(await prisma.twoFactor.count({ where: { userId: ana.id } })).toBe(0);
    expect(await signedInAs(off?.jar ?? "")).toBe(ana.id);
    expect(log.events.find((line) => line.event === "auth.twofactor.disabled")).toMatchObject({
      userId: ana.id,
    });
    // And the password alone signs in again.
    expect((await passwordStep(ana)).body).not.toHaveProperty("twoFactorRedirect");
  });

  it("replaces the backup codes with the password, and the old ones stop working", async () => {
    const ana = await enrolled("set-codes");

    let replaced: Awaited<ReturnType<typeof change>> | undefined;
    const log = await eventsDuring(async () => {
      replaced = await change("generate-backup-codes", ana.jar, { password: PASSWORD });
    });

    expect(replaced?.status).toBe(200);
    const codes = replaced?.body?.backupCodes as string[];
    expect(codes).toHaveLength(10);
    expect(codes).not.toContain(ana.backupCodes[0]);
    expect(log.events.find((line) => line.event === "auth.twofactor.codes-regenerated")).toMatchObject({
      userId: ana.id,
    });
    for (const shown of codes) expect(log.raw).not.toContain(shown);

    const old = await secondStep("backup-code", await challenge(ana), { code: ana.backupCodes[0] });
    expect(old.status).toBe(401);
    const fresh = await secondStep("backup-code", await challenge(ana), { code: codes[0] });
    expect(fresh.status).toBe(200);
  });

  it("refuses a browser that is not signed in, before any password", async () => {
    const answer = await change("enable", "", { password: PASSWORD });

    expect(answer.status).toBe(401);
  });
});
