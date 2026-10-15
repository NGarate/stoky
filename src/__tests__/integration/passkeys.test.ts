import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import type { HouseholdRole } from "@prisma/client";
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { readSession } from "@/lib/auth";
import { getAuth } from "@/lib/auth/instance";
import { endSessions } from "@/lib/auth/end-sessions";
import { STEP_UP_PREFIX } from "@/lib/auth/step-up";
import { BROWSER_IDLE_S, MAX_SESSIONS_PER_ACCOUNT } from "@/lib/auth/session-policy";
import { prisma } from "@/lib/prisma";
import { signInWith, testOrigin } from "../utils/authorize";
import { createTestHousehold, createTestUser, generateTestEmail } from "../utils/test-helpers";
import {
  SoftAuthenticator,
  authPost,
  registerPasskey,
  signInWithPasskey,
  type BrowserState,
} from "../utils/webauthn";

/**
 * Passkeys through the real route, Better Auth's passkey plugin and
 * `@simplewebauthn/server`, with a software authenticator standing in for the
 * phone (`utils/webauthn.ts`) — PROGRESS D151.
 *
 * What is under test is this application's part: a passkey is added or
 * removed only after the password (the step-up), the person must have been
 * verified by the authenticator, the sign-in honours the remember-me box and
 * the ten-session cap, a registration never signs anybody in, and a passkey
 * belongs to the first `STOKY_URLS` address alone. The suite's instance is
 * built for http://localhost:3000, where passkeys are available.
 */

const PASSWORD = "cocina despensa nevera";
const MARKER = `passkeys-${process.pid}-${Date.now().toString(36)}`;
let householdId: string;
/** Everybody this file made, whose step-ups (`Verification` rows, no foreign key) it removes. */
const made: string[] = [];

beforeAll(async () => {
  householdId = (await createTestHousehold({ name: `${MARKER} casa` })).id;
});

afterAll(async () => {
  await prisma.verification.deleteMany({ where: { value: { in: made } } });
  await prisma.user.deleteMany({ where: { email: { contains: MARKER } } });
  await prisma.household.deleteMany({ where: { name: { contains: MARKER } } });
});

interface Person {
  id: string;
  email: string;
}

interface Device extends BrowserState {
  cookie: string;
  sessionId: string;
}

async function person(label: string, role: HouseholdRole = "MEMBER"): Promise<Person> {
  const email = generateTestEmail(`${MARKER}-${label.toLowerCase()}`);
  const user = await createTestUser({ email, name: `${MARKER} ${label}`, password: PASSWORD, householdId, role });
  made.push(user.id);
  return { id: user.id, email };
}

/** Signs `who` in with the password, as a browser that keeps the cookies. */
async function signedIn(who: Person): Promise<Device> {
  const deviceId = crypto.randomUUID();
  const outcome = await signInWith({ email: who.email, password: PASSWORD }, { deviceId });
  expect(outcome.status).toBe(200);
  const cookie = `stoky_device=${deviceId}; ${outcome.cookieHeader}`;
  const session = await readSession(new Headers({ cookie }), { refresh: false });
  if (!session) throw new Error("the sign-in left no session");
  return { cookie, sessionId: session.sessionId };
}

/** `auth.confirmPassword` from `device`'s own session, as the settings page will call it. */
async function confirmPassword(device: Device, currentPassword = PASSWORD) {
  const session = await readSession(new Headers({ cookie: device.cookie }), { refresh: false });
  if (!session) throw new Error("that device is signed out");
  const ctx = await createTRPCContext({
    session,
    headers: new Headers({ "x-forwarded-for": "203.0.113.33", cookie: device.cookie }),
  });
  return appRouter.createCaller(ctx).auth.confirmPassword({ currentPassword });
}

const stepUps = (sessionId: string) =>
  prisma.verification.count({ where: { identifier: `${STEP_UP_PREFIX}${sessionId}` } });

/** The security-log lines written while `run` ran, parsed. */
async function eventsDuring<T>(run: () => Promise<T>): Promise<{ result: T; events: Record<string, string>[] }> {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await run();
    const events = warn.mock.calls.flatMap((call) => {
      try {
        return [JSON.parse(String(call[0])) as Record<string, string>];
      } catch {
        return [];
      }
    });
    return { result, events };
  } finally {
    warn.mockRestore();
  }
}

/** A person with a passkey registered, and the browser they registered it from. */
async function enrolled(label: string, role: HouseholdRole = "MEMBER") {
  const who = await person(label, role);
  const device = await signedIn(who);
  const authenticator = SoftAuthenticator.create();
  await confirmPassword(device);
  const { verified } = await registerPasskey(authenticator, device);
  expect(verified?.status).toBe(200);
  return { who, device, authenticator };
}

describe("adding a passkey", () => {
  it("is refused without the password re-entered first", async () => {
    const who = await person("NoStepUp");
    const device = await signedIn(who);

    const { options, verified } = await registerPasskey(SoftAuthenticator.create(), device);

    expect(options.status).toBe(403);
    expect(options.code).toBe("STEP_UP_REQUIRED");
    expect(verified).toBeNull();
    expect(await prisma.passkey.count({ where: { userId: who.id } })).toBe(0);
  });

  it("works after it, spends the step-up, and is logged", async () => {
    const who = await person("StepUp");
    const device = await signedIn(who);
    const authenticator = SoftAuthenticator.create();

    const confirmed = await confirmPassword(device);
    expect(new Date(confirmed.expiresAt).getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(await stepUps(device.sessionId)).toBe(1);

    const { result, events } = await eventsDuring(() => registerPasskey(authenticator, device));

    expect(result.verified?.status).toBe(200);
    const row = await prisma.passkey.findFirstOrThrow({ where: { userId: who.id } });
    expect(row.credentialID).toBe(authenticator.id);
    expect(row.name).toBe("Probe");
    // Single use: the registration spent it.
    expect(await stepUps(device.sessionId)).toBe(0);
    expect(events.find((line) => line.event === "auth.passkey.added")).toMatchObject({ userId: who.id });
    expect(JSON.stringify(events)).not.toContain(row.publicKey);
  });

  it("is refused a second time on the same step-up", async () => {
    const { device } = await enrolled("SpentOnce");

    const again = await registerPasskey(SoftAuthenticator.create(), device);

    expect(again.options.status).toBe(403);
    expect(again.options.code).toBe("STEP_UP_REQUIRED");
  });

  it("is not allowed by another session's step-up, the same account's included", async () => {
    const who = await person("OtherSession");
    const phone = await signedIn(who);
    const tablet = await signedIn(who);
    await confirmPassword(phone);

    const { options } = await registerPasskey(SoftAuthenticator.create(), tablet);

    expect(options.status).toBe(403);
    // The phone's is still there, for the phone.
    expect(await stepUps(phone.sessionId)).toBe(1);
  });

  it("is open to the kitchen's shared account, as to everybody", async () => {
    // The owner's decision of 2026-10-15: no role is refused.
    const { who } = await enrolled("Kitchen", "KITCHEN");
    expect(await prisma.passkey.count({ where: { userId: who.id } })).toBe(1);
  });

  it("is refused when the authenticator did not verify the person", async () => {
    const who = await person("NoUvRegister");
    const device = await signedIn(who);
    await confirmPassword(device);

    const { verified } = await registerPasskey(SoftAuthenticator.create(), device, { uv: false });

    expect(verified?.status).toBe(401);
    expect(verified?.code).toBe("USER_VERIFICATION_REQUIRED");
    expect(await prisma.passkey.count({ where: { userId: who.id } })).toBe(0);
  });

  it("never signs anybody in, whatever the request asks", async () => {
    const who = await person("NoSession");
    const device = await signedIn(who);
    const before = await prisma.session.count({ where: { userId: who.id } });

    // Through the route, which drops the key.
    await confirmPassword(device);
    const routed = await registerPasskey(SoftAuthenticator.create(), device, {
      extraBody: { createSession: true },
    });
    expect(routed.verified?.status).toBe(200);
    expect((routed.verified!.body as Record<string, unknown>).session).toBeUndefined();

    // And straight to Better Auth, past the route: the policy plugin forces it off.
    await confirmPassword(device);
    const auth = getAuth();
    const headers = new Headers({ cookie: device.cookie, origin: testOrigin() });
    const options = await auth.api.generatePasskeyRegistrationOptions({ headers, returnHeaders: true });
    const challenge = options.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");
    const authenticator = SoftAuthenticator.create();
    const direct = await auth.api.verifyPasskeyRegistration({
      headers: new Headers({ cookie: `${device.cookie}; ${challenge}`, origin: testOrigin() }),
      body: {
        response: authenticator.register(options.response, { origin: testOrigin() }),
        createSession: true,
      } as never,
    });
    expect((direct as Record<string, unknown>).session).toBeUndefined();

    expect(await prisma.session.count({ where: { userId: who.id } })).toBe(before);
    expect(await prisma.passkey.count({ where: { userId: who.id } })).toBe(2);
  });
});

describe("the step-up", () => {
  it("is refused with a wrong password, which writes nothing and is logged", async () => {
    const who = await person("WrongPassword");
    const device = await signedIn(who);

    const { result, events } = await eventsDuring(() =>
      confirmPassword(device, "not the password").catch((error: unknown) => error),
    );

    expect(result).toBeInstanceOf(TRPCError);
    expect((result as TRPCError).code).toBe("BAD_REQUEST");
    expect(await stepUps(device.sessionId)).toBe(0);
    expect(events.find((line) => line.event === "auth.reauth.refused")).toMatchObject({
      userId: who.id,
      via: "step-up",
    });
  });

  it("goes with its session when the session is ended", async () => {
    const who = await person("EndsWith");
    const phone = await signedIn(who);
    const laptop = await signedIn(who);
    await confirmPassword(phone);
    await confirmPassword(laptop);

    await endSessions(prisma, { userId: who.id, id: phone.sessionId });

    expect(await stepUps(phone.sessionId)).toBe(0);
    expect(await stepUps(laptop.sessionId)).toBe(1);
  });
});

describe("removing a passkey", () => {
  it("needs the step-up, spends it, and is logged", async () => {
    const { who, device } = await enrolled("Removes");
    const { id } = await prisma.passkey.findFirstOrThrow({ where: { userId: who.id } });

    const refused = await authPost("/passkey/delete-passkey", { id }, device);
    expect(refused.status).toBe(403);
    expect(refused.code).toBe("STEP_UP_REQUIRED");
    expect(await prisma.passkey.count({ where: { id } })).toBe(1);

    await confirmPassword(device);
    const { result, events } = await eventsDuring(() =>
      authPost("/passkey/delete-passkey", { id }, device),
    );
    expect(result.status).toBe(200);
    expect(await prisma.passkey.count({ where: { id } })).toBe(0);
    expect(await stepUps(device.sessionId)).toBe(0);
    expect(events.find((line) => line.event === "auth.passkey.removed")).toMatchObject({ userId: who.id });
  });
});

describe("a bearer token (D142) is no way round the step-up", () => {
  /** A native client's sign-in: no cookie, no Origin, the token in a header. */
  async function nativeSignIn(who: Person): Promise<{ authorization: string; sessionId: string }> {
    const answer = await signInWith({ email: who.email, password: PASSWORD });
    expect(answer.status).toBe(200);
    const token = answer.headers.get("set-auth-token");
    if (!token) throw new Error("a native sign-in was given no set-auth-token");
    const authorization = `Bearer ${token}`;
    const session = await readSession(new Headers({ authorization }), { refresh: false });
    if (!session) throw new Error("the bearer token reads as no session");
    return { authorization, sessionId: session.sessionId };
  }

  /** The auth route, as a native client calls it: the token, no cookie, no Origin. */
  async function bearerCall(method: "GET" | "POST", path: string, authorization: string, body?: unknown) {
    const url = `${testOrigin()}/api/auth${path}`;
    const headers = { authorization, "x-forwarded-for": "203.0.113.34" };
    const response =
      method === "GET"
        ? await GET(new Request(url, { headers }))
        : await POST(
            new Request(url, {
              method: "POST",
              headers: { ...headers, "content-type": "application/json" },
              body: JSON.stringify(body ?? {}),
            }),
          );
    const parsed = (await response.json().catch(() => null)) as { code?: string } | null;
    return { status: response.status, code: parsed?.code };
  }

  it("refuses a bearer session the registration options and a removal without it", async () => {
    // Better Auth hands a before-hook the request before the bearer plugin
    // turns the token into a cookie, so a check reading the session there
    // found none, stood aside, and the endpoint then served the token's
    // session: a stolen token became a passkey nobody had re-entered the
    // password for.
    const { who } = await enrolled("BearerNoStepUp");
    const { id } = await prisma.passkey.findFirstOrThrow({ where: { userId: who.id } });
    const native = await nativeSignIn(who);

    const options = await bearerCall("GET", "/passkey/generate-register-options", native.authorization);
    expect(options.status).toBe(403);
    expect(options.code).toBe("STEP_UP_REQUIRED");

    const removal = await bearerCall("POST", "/passkey/delete-passkey", native.authorization, { id });
    expect(removal.status).toBe(403);
    expect(removal.code).toBe("STEP_UP_REQUIRED");
    expect(await prisma.passkey.count({ where: { id } })).toBe(1);
  });

  it("lets a bearer session through once it has re-entered the password, as a browser's", async () => {
    const { who } = await enrolled("BearerStepUp");
    const { id } = await prisma.passkey.findFirstOrThrow({ where: { userId: who.id } });
    const native = await nativeSignIn(who);
    const session = await readSession(new Headers({ authorization: native.authorization }), { refresh: false });
    if (!session) throw new Error("the bearer token reads as no session");
    const ctx = await createTRPCContext({
      session,
      headers: new Headers({ "x-forwarded-for": "203.0.113.35", authorization: native.authorization }),
    });
    await appRouter.createCaller(ctx).auth.confirmPassword({ currentPassword: PASSWORD });

    const options = await bearerCall("GET", "/passkey/generate-register-options", native.authorization);
    expect(options.status).toBe(200);
    const removal = await bearerCall("POST", "/passkey/delete-passkey", native.authorization, { id });
    expect(removal.status).toBe(200);
    expect(await prisma.passkey.count({ where: { id } })).toBe(0);
    expect(await stepUps(native.sessionId)).toBe(0);
  });
});

describe("signing in with a passkey", () => {
  it("is refused when the authenticator did not verify the person, and creates nothing", async () => {
    const { who, authenticator } = await enrolled("NoUvSignIn");
    const before = await prisma.session.count({ where: { userId: who.id } });

    const { result, events } = await eventsDuring(() =>
      signInWithPasskey(authenticator, {}, { uv: false }),
    );

    expect(result.verified.status).toBe(401);
    expect(result.verified.code).toBe("USER_VERIFICATION_REQUIRED");
    expect(result.verified.setCookie.filter((line) => line.includes("session_token="))).toEqual([]);
    expect(await prisma.session.count({ where: { userId: who.id } })).toBe(before);
    expect(events.find((line) => line.event === "auth.passkey.signin-failed")).toMatchObject({
      code: "USER_VERIFICATION_REQUIRED",
    });
  });

  it("signs the person in when it did, and is logged as a passkey sign-in", async () => {
    const { who, authenticator } = await enrolled("SignsIn");

    const { result, events } = await eventsDuring(() => signInWithPasskey(authenticator));

    expect(result.verified.status).toBe(200);
    const session = await readSession(new Headers({ cookie: result.verified.cookieHeader }), {
      refresh: false,
    });
    expect(session?.user.id).toBe(who.id);
    // Never the token in the body.
    expect(JSON.stringify(result.verified.body)).not.toContain(`"token"`);
    expect(events.find((line) => line.event === "auth.signin.succeeded")).toMatchObject({
      userId: who.id,
      method: "passkey",
    });
  });

  it("unticked, is a browser session with one session cookie and no Max-Age", async () => {
    const { who, authenticator } = await enrolled("Unticked");

    const { verified } = await signInWithPasskey(authenticator, {}, { rememberMe: false });

    expect(verified.status).toBe(200);
    const sessionCookies = verified.setCookie.filter((line) => line.startsWith("stoky.session_token="));
    expect(sessionCookies).toHaveLength(1);
    expect(sessionCookies[0]).not.toMatch(/max-age/i);
    expect(verified.setCookie.some((line) => line.startsWith("stoky.dont_remember="))).toBe(true);

    const session = await readSession(new Headers({ cookie: verified.cookieHeader }), { refresh: false });
    const row = await prisma.session.findUniqueOrThrow({ where: { id: session!.sessionId } });
    expect(row.userId).toBe(who.id);
    expect(row.persistent).toBe(false);
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(BROWSER_IDLE_S * 1000);
  });

  it("ticked, is remembered, with a cookie that outlives the browser", async () => {
    const { authenticator } = await enrolled("Ticked");

    const { verified } = await signInWithPasskey(
      authenticator,
      { cookie: "stoky.dont_remember=true.left-by-an-earlier-sign-in" },
      { rememberMe: true },
    );

    expect(verified.status).toBe(200);
    const sessionCookies = verified.setCookie.filter((line) => line.startsWith("stoky.session_token="));
    expect(sessionCookies).toHaveLength(1);
    expect(sessionCookies[0]).toMatch(/max-age=\d+/i);
    // The earlier unticked sign-in's cookie is cleared in the browser.
    expect(verified.setCookie).toContain("stoky.dont_remember=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");

    const session = await readSession(new Headers({ cookie: verified.cookieHeader }), { refresh: false });
    const row = await prisma.session.findUniqueOrThrow({ where: { id: session!.sessionId } });
    expect(row.persistent).toBe(true);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it("ends the least recently used session when it would be the eleventh", async () => {
    const { who, authenticator } = await enrolled("Cap");
    await prisma.session.deleteMany({ where: { userId: who.id } });
    const now = Date.now();
    const existing = [];
    for (let i = 0; i < MAX_SESSIONS_PER_ACCOUNT; i += 1) {
      existing.push(
        await prisma.session.create({
          data: {
            token: `${MARKER}-cap-${i}-${crypto.randomUUID()}`,
            userId: who.id,
            expiresAt: new Date(now + 10 * 60 * 1000),
            // The last one made is the least recently used.
            updatedAt: new Date(now - (i + 1) * 60 * 1000),
          },
        }),
      );
    }

    const { verified } = await signInWithPasskey(authenticator);

    expect(verified.status).toBe(200);
    const left = await prisma.session.findMany({ where: { userId: who.id }, select: { id: true } });
    expect(left).toHaveLength(MAX_SESSIONS_PER_ACCOUNT);
    expect(left.map(({ id }) => id)).not.toContain(existing.at(-1)!.id);
    expect(left.map(({ id }) => id)).toContain(existing[0].id);
  });

  it("is refused for a passkey this server does not know", async () => {
    const { verified } = await signInWithPasskey(SoftAuthenticator.create());
    expect(verified.status).toBe(401);
    expect(verified.code).toBe("PASSKEY_NOT_FOUND");
  });
});

describe("a passkey belongs to the first STOKY_URLS address", () => {
  it("is refused from the second, which is trusted for everything else", async () => {
    const { authenticator } = await enrolled("SecondAddress");
    const second = "http://stoky.localhost:3000";

    // A process of its own, because the instance is built once per process
    // from the environment it starts with; this one lists two addresses.
    const base: Record<string, string | undefined> = { ...process.env };
    delete base.NEXT_PHASE;
    const script = `const { SoftAuthenticator, signInWithPasskey } = await import("@/__tests__/utils/webauthn");
      const authenticator = SoftAuthenticator.fromJSON(JSON.parse(process.env.AUTHENTICATOR_UNDER_TEST));
      const answers = [];
      for (const origin of [process.env.SECOND_UNDER_TEST, process.env.FIRST_UNDER_TEST]) {
        const { verified } = await signInWithPasskey(authenticator, { origin });
        answers.push({ status: verified.status, code: verified.code });
      }
      console.log(JSON.stringify(answers));
      process.exit(0);`;
    const child = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: join(import.meta.dir, "../../.."),
      env: {
        ...base,
        // Empty rather than absent: Bun loads `.env` for a key that is absent.
        NEXTAUTH_URL: "",
        DEV_ALLOWED_ORIGIN: "",
        STOKY_URLS: `${testOrigin()}, ${second}`,
        AUTHENTICATOR_UNDER_TEST: JSON.stringify(authenticator.toJSON()),
        FIRST_UNDER_TEST: testOrigin(),
        SECOND_UNDER_TEST: second,
      },
    });
    if (child.exitCode !== 0) throw new Error(child.stderr.toString());
    const [atSecond, atFirst] = JSON.parse(
      child.stdout.toString().trim().split("\n").at(-1)!,
    ) as { status: number; code?: string }[];

    // The page at the second address is trusted — the request is not refused
    // as a foreign origin — but the passkey's signature names that origin,
    // and a passkey is the first address's alone.
    expect(atSecond.status).toBe(400);
    expect(atSecond.code).toBe("AUTHENTICATION_FAILED");
    expect(atFirst.status).toBe(200);
  });
});
