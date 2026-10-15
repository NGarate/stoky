import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { createTrpcHandler } from "@/server/http/trpc-handler";
import { readSession } from "@/lib/auth";
import { BROWSER_CAP_S, BROWSER_IDLE_S } from "@/lib/auth/session-policy";
import { prisma } from "@/lib/prisma";
import { signInWith, testOrigin } from "../utils/authorize";
import { createTestUser, generateTestEmail } from "../utils/test-helpers";

/**
 * How long a browser session lives, through the real route, the real Better
 * Auth and the real row (PROGRESS D135).
 *
 * Fifteen idle minutes, slid only by `auth.session` — the keep-alive's call on
 * real activity — and never past a day from the sign-in. Each test signs in
 * for real, then moves the row's clock rather than waiting: the row is the
 * only lifetime that counts, so a row that says fourteen minutes have passed
 * is a session fourteen minutes old.
 */

const PASSWORD = "cocina despensa nevera";
const MARKER = `policy-${process.pid}-${Date.now().toString(36)}`;
const MINUTE = 60_000;
let email: string;
let userId: string;

beforeAll(async () => {
  email = generateTestEmail(MARKER);
  userId = (await createTestUser({ email, name: `Policy ${MARKER}`, password: PASSWORD })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: MARKER } } });
});

interface Browser {
  headers: Headers;
  sessionId: string;
  setCookie: string[];
}

async function signIn(): Promise<Browser> {
  const answer = await signInWith({ email, password: PASSWORD });
  expect(answer.status).toBe(200);
  const headers = new Headers({ cookie: answer.cookieHeader });
  const session = await readSession(headers, { refresh: false });
  if (!session) throw new Error("a fresh sign-in read no session");
  return { headers, sessionId: session.sessionId, setCookie: answer.setCookie };
}

const row = (id: string) => prisma.session.findUnique({ where: { id } });

/** Moves the row as if `idleMs` had passed since it was last slid. */
async function idle(id: string, idleMs: number, authenticatedAgoMs = idleMs): Promise<void> {
  const now = Date.now();
  await prisma.session.update({
    where: { id },
    data: {
      expiresAt: new Date(now + BROWSER_IDLE_S * 1000 - idleMs),
      authenticatedAt: new Date(now - authenticatedAgoMs),
    },
  });
}

/** `auth.session`, asked the way the keep-alive asks: with this browser's session. */
async function keepAlive(browser: Browser) {
  const session = await readSession(browser.headers, { refresh: true });
  const caller = appRouter.createCaller(
    await createTRPCContext({ session, headers: browser.headers }),
  );
  return caller.auth.session();
}

describe("a new browser session", () => {
  it("ends fifteen idle minutes from the sign-in, and its cookie with the browser", async () => {
    const before = Date.now();
    const browser = await signIn();

    const stored = await row(browser.sessionId);
    const expires = stored!.expiresAt.getTime();
    expect(expires).toBeGreaterThanOrEqual(before + BROWSER_IDLE_S * 1000 - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + BROWSER_IDLE_S * 1000 + 1000);
    expect(stored!.authenticatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(stored!.ipAddress).toBeNull();

    const sessionCookie = browser.setCookie.find((line) => line.startsWith("stoky.session_token="));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).not.toMatch(/max-age|expires=/i);
    expect(sessionCookie).toMatch(/HttpOnly/);
  });
});

describe("what slides it", () => {
  it("is auth.session, fourteen minutes in", async () => {
    const browser = await signIn();
    await idle(browser.sessionId, 14 * MINUTE);

    const answer = await keepAlive(browser);

    const slid = (await row(browser.sessionId))!.expiresAt.getTime();
    expect(slid).toBeGreaterThan(Date.now() + 14 * MINUTE);
    expect(answer?.expires).toBe(new Date(slid).toISOString());
  });

  it("is not a protected tRPC call, however many", async () => {
    // A dashboard left open polls; polling is not somebody at the screen.
    const browser = await signIn();
    await idle(browser.sessionId, 14 * MINUTE);
    const before = (await row(browser.sessionId))!.expiresAt.getTime();

    const handler = createTrpcHandler({
      router: appRouter,
      getSession: () => readSession(request.headers, { refresh: true }),
      createContext: createTRPCContext,
    });
    const request = new Request(`${testOrigin()}/api/trpc/auth.me`, { headers: browser.headers });
    const response = await handler(request);

    expect(response.status).toBe(200);
    expect((await row(browser.sessionId))!.expiresAt.getTime()).toBe(before);
  });

  it("is not a page render's read either", async () => {
    const browser = await signIn();
    await idle(browser.sessionId, 14 * MINUTE);
    const before = (await row(browser.sessionId))!.expiresAt.getTime();

    expect(await readSession(browser.headers, { refresh: false })).not.toBeNull();
    expect(await readSession(browser.headers, { refresh: true })).not.toBeNull();

    expect((await row(browser.sessionId))!.expiresAt.getTime()).toBe(before);
  });

  it("is not Better Auth's own refresh, even for a cookie without its dont_remember", async () => {
    // Better Auth refreshes a session it thinks is remembered on any read
    // that allows it, pushing the row ninety days out. Every session here is
    // a browser session; the update hook drops that expiry, so a browser that
    // lost its `dont_remember` cookie gets nothing for it.
    const browser = await signIn();
    const before = (await row(browser.sessionId))!.expiresAt.getTime();
    const withoutDontRemember = new Headers({
      cookie: browser.headers
        .get("cookie")!
        .split("; ")
        .filter((pair) => !pair.startsWith("stoky.dont_remember="))
        .join("; "),
    });

    expect(await readSession(withoutDontRemember, { refresh: true })).not.toBeNull();

    expect((await row(browser.sessionId))!.expiresAt.getTime()).toBe(before);
  });
});

describe("what ends it", () => {
  it("is fifteen idle minutes: the read is refused and the row deleted", async () => {
    const browser = await signIn();
    await idle(browser.sessionId, BROWSER_IDLE_S * 1000 + 1000);

    expect(await readSession(browser.headers, { refresh: false })).toBeNull();
    expect(await row(browser.sessionId)).toBeNull();
  });

  it("is a day after the sign-in, however active", async () => {
    const browser = await signIn();
    // Slid a minute ago, but signed in a day and a second ago.
    await idle(browser.sessionId, MINUTE, BROWSER_CAP_S * 1000 + 1000);

    await keepAlive(browser);

    expect(await readSession(browser.headers, { refresh: false })).toBeNull();
  });

  it("is the row being deleted, on the very next read", async () => {
    // Nothing caches the session: no cookie cache, no signed copy of it in
    // the browser to outlive the row.
    const browser = await signIn();
    expect(await readSession(browser.headers, { refresh: false })).not.toBeNull();

    await prisma.session.delete({ where: { id: browser.sessionId } });

    expect(await readSession(browser.headers, { refresh: false })).toBeNull();
  });

  it("answers the keep-alive with null once it has ended", async () => {
    const browser = await signIn();
    await prisma.session.delete({ where: { id: browser.sessionId } });

    expect(await keepAlive(browser)).toBeNull();
  });
});

describe("whose session it is", () => {
  it("is the account that signed in, with its row's id", async () => {
    const browser = await signIn();
    const session = await readSession(browser.headers, { refresh: false });

    expect(session?.user.id).toBe(userId);
    expect(session?.sessionId).toBe(browser.sessionId);
    expect(session?.user.householdId).toBeUndefined();
  });
});
