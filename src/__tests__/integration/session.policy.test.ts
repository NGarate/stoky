import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { createTrpcHandler } from "@/server/http/trpc-handler";
import { readSession } from "@/lib/auth";
import { getAuth } from "@/lib/auth/instance";
import {
  BROWSER_CAP_S,
  BROWSER_IDLE_S,
  REMEMBERED_CAP_S,
  REMEMBERED_IDLE_S,
} from "@/lib/auth/session-policy";
import { prisma } from "@/lib/prisma";
import { cookieHeaderFrom, signInWith, testOrigin } from "../utils/authorize";
import { createTestUser, generateTestEmail } from "../utils/test-helpers";

/**
 * How long a session lives, through the real route, the real Better Auth and
 * the real row (PROGRESS D135, D141).
 *
 * A browser session: fifteen idle minutes, slid only by `auth.session` — the
 * keep-alive's call on real activity — and never past a day from the sign-in.
 * A remembered one, when the box was ticked: ninety idle days, slid at most
 * daily by a tRPC read, and never past a year from the sign-in. Each test signs in
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

async function signIn(
  { rememberMe, cookie }: { rememberMe?: unknown; cookie?: string } = {},
): Promise<Browser> {
  const answer = await signInWith(
    rememberMe === undefined
      ? { email, password: PASSWORD }
      : { email, password: PASSWORD, rememberMe },
    cookie ? { cookie } : {},
  );
  expect(answer.status).toBe(200);
  const headers = new Headers({
    cookie: cookie ? mergeJar(cookie, answer.setCookie) : answer.cookieHeader,
  });
  const session = await readSession(headers, { refresh: false });
  if (!session) throw new Error("a fresh sign-in read no session");
  return { headers, sessionId: session.sessionId, setCookie: answer.setCookie };
}

const row = (id: string) => prisma.session.findUnique({ where: { id } });

/**
 * The `Cookie` header a browser holding `jar` sends after an answer's
 * `Set-Cookie` lines: each line replaces its name, and an expired one removes it.
 */
function mergeJar(jar: string, setCookie: string[]): string {
  const cookies = new Map(
    jar.split("; ").filter(Boolean).map((pair) => [pair.split("=", 1)[0], pair] as const),
  );
  for (const line of setCookie) {
    const pair = line.split(";")[0].trim();
    const name = pair.split("=", 1)[0];
    if (cookieHeaderFrom([line]) === "") cookies.delete(name);
    else cookies.set(name, pair);
  }
  return [...cookies.values()].join("; ");
}

const DAY = 24 * 60 * MINUTE;

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
  it("is what a sign-in that does not mention the box gets", async () => {
    // Better Auth reads a missing `rememberMe` as true; the route does not.
    const browser = await signIn();
    expect((await row(browser.sessionId))!.persistent).toBe(false);
    const sessionCookie = browser.setCookie.find((line) => line.startsWith("stoky.session_token="));
    expect(sessionCookie).not.toMatch(/max-age|expires=/i);
  });

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

describe("which deadline it says is next", () => {
  // WCAG 2.2.6: the keep-alive offers "Seguir conectado" only while pressing
  // it can move the expiry. The server is what knows.
  it("is the idle one for a session with its day ahead, on the render and the keep-alive", async () => {
    const browser = await signIn();
    await idle(browser.sessionId, 14 * MINUTE);

    expect((await readSession(browser.headers, { refresh: false }))?.expiresKind).toBe("idle");
    expect((await keepAlive(browser))?.kind).toBe("idle");
  });

  it("is the limit once activity can no longer move it", async () => {
    // Signed in a day less ten minutes ago, slid six minutes ago: the idle
    // deadline is nine minutes out, a minute short of the limit. Activity now
    // slides it to the limit and no further, and both answers say so.
    const browser = await signIn();
    await idle(browser.sessionId, 6 * MINUTE, BROWSER_CAP_S * 1000 - 10 * MINUTE);
    const authenticatedAt = (await row(browser.sessionId))!.authenticatedAt.getTime();
    expect((await readSession(browser.headers, { refresh: false }))?.expiresKind).toBe("idle");

    const answer = await keepAlive(browser);

    expect(answer?.kind).toBe("cap");
    expect(new Date(answer!.expires).getTime()).toBe(authenticatedAt + BROWSER_CAP_S * 1000);
    expect((await readSession(browser.headers, { refresh: false }))?.expiresKind).toBe("cap");
  });

  it("is the limit on an answer that did not slide, too", async () => {
    // Fresh enough not to be written, already at the limit: the early answer
    // must carry the kind as well as the write's.
    const browser = await signIn();
    const now = Date.now();
    await prisma.session.update({
      where: { id: browser.sessionId },
      data: {
        authenticatedAt: new Date(now - BROWSER_CAP_S * 1000 + BROWSER_IDLE_S * 1000 - 30_000),
        expiresAt: new Date(now + BROWSER_IDLE_S * 1000 - 30_000),
      },
    });

    expect((await keepAlive(browser))?.kind).toBe("cap");
  });
});

describe("a remembered session", () => {
  /** Sets the row's clocks as if the session had been used `usedAgoMs` ago. */
  async function used(
    id: string,
    { usedAgoMs, authenticatedAgoMs }: { usedAgoMs: number; authenticatedAgoMs: number },
  ): Promise<void> {
    const now = Date.now();
    await prisma.session.update({
      where: { id },
      data: {
        updatedAt: new Date(now - usedAgoMs),
        // What Better Auth's refresh left at that moment: ninety days on.
        expiresAt: new Date(now - usedAgoMs + REMEMBERED_IDLE_S * 1000),
        authenticatedAt: new Date(now - authenticatedAgoMs),
      },
    });
  }

  it("is ninety days in the cookie and on the row when the box is ticked", async () => {
    const before = Date.now();
    const browser = await signIn({ rememberMe: true });

    const stored = (await row(browser.sessionId))!;
    expect(stored.persistent).toBe(true);
    expect(stored.expiresAt.getTime()).toBeGreaterThanOrEqual(before + REMEMBERED_IDLE_S * 1000 - 1000);
    expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + REMEMBERED_IDLE_S * 1000 + 1000);

    const sessionCookie = browser.setCookie.find((line) => line.startsWith("stoky.session_token="));
    const maxAge = Number(/max-age=(\d+)/i.exec(sessionCookie ?? "")?.[1]);
    expect(maxAge).toBe(REMEMBERED_IDLE_S);

    // Its deadline is the idle one: ninety days is far inside the year.
    expect((await readSession(browser.headers, { refresh: false }))?.expiresKind).toBe("idle");
  });

  it("is what the route's header says, over what Better Auth was asked", async () => {
    // The create hook falls back to Better Auth's own signals only when the
    // route said nothing. On the route's sign-in the two agree, so this asks
    // the instance directly with a header that contradicts the body: the
    // route's word is the one that counts.
    const answer = (await getAuth().api.signInEmail({
      body: { email, password: PASSWORD, rememberMe: true },
      headers: new Headers({ "x-stoky-remember": "0" }),
    })) as { token: string };

    const stored = await prisma.session.findUnique({ where: { token: answer.token } });
    expect(stored?.persistent).toBe(false);
    expect(stored!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + BROWSER_IDLE_S * 1000 + 1000);
  });

  it("is slid by a tRPC read once a day has passed since it was last written", async () => {
    const browser = await signIn({ rememberMe: true });
    await used(browser.sessionId, { usedAgoMs: DAY + 1000, authenticatedAgoMs: 10 * DAY });
    const before = Date.now();

    expect(await readSession(browser.headers, { refresh: true })).not.toBeNull();

    const slid = (await row(browser.sessionId))!;
    expect(slid.expiresAt.getTime()).toBeGreaterThanOrEqual(before + REMEMBERED_IDLE_S * 1000 - 1000);
    expect(slid.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("is not written by a read within the day, nor by a render's read ever", async () => {
    const browser = await signIn({ rememberMe: true });
    await used(browser.sessionId, { usedAgoMs: DAY - MINUTE, authenticatedAgoMs: 10 * DAY });
    const within = (await row(browser.sessionId))!;

    expect(await readSession(browser.headers, { refresh: true })).not.toBeNull();
    expect((await row(browser.sessionId))!.updatedAt).toEqual(within.updatedAt);

    await used(browser.sessionId, { usedAgoMs: DAY + 1000, authenticatedAgoMs: 10 * DAY });
    const due = (await row(browser.sessionId))!;
    expect(await readSession(browser.headers, { refresh: false })).not.toBeNull();
    expect((await row(browser.sessionId))!.expiresAt).toEqual(due.expiresAt);
  });

  it("is not written on every read once the year holds its expiry still", async () => {
    // Better Auth's own rule — refresh when less than ninety days less a day
    // is left — is true on every read for the year's last three months. A
    // row written a minute ago is not due, whatever its expiry says.
    const browser = await signIn({ rememberMe: true });
    const now = Date.now();
    const authenticatedAt = new Date(now - 300 * DAY);
    await prisma.session.update({
      where: { id: browser.sessionId },
      data: {
        authenticatedAt,
        expiresAt: new Date(authenticatedAt.getTime() + REMEMBERED_CAP_S * 1000),
        updatedAt: new Date(now - MINUTE),
      },
    });
    const before = (await row(browser.sessionId))!;

    expect(await readSession(browser.headers, { refresh: true })).not.toBeNull();

    expect((await row(browser.sessionId))!.updatedAt).toEqual(before.updatedAt);
  });

  it("is refused a year and a second after the sign-in, though it was used yesterday", async () => {
    // Signed in 364 days ago, last slid a day and a second ago: the slide now
    // may reach a year from the sign-in — a day from now — and no further.
    const browser = await signIn({ rememberMe: true });
    await used(browser.sessionId, { usedAgoMs: DAY + 1000, authenticatedAgoMs: 364 * DAY });
    expect(await readSession(browser.headers, { refresh: true })).not.toBeNull();
    const slid = (await row(browser.sessionId))!;
    expect(slid.expiresAt.getTime()).toBe(slid.authenticatedAt.getTime() + REMEMBERED_CAP_S * 1000);

    // A day and a second pass, the way the other tests let time pass: every
    // clock on the row moves back by that much.
    const elapsed = DAY + 1000;
    await prisma.session.update({
      where: { id: browser.sessionId },
      data: {
        expiresAt: new Date(slid.expiresAt.getTime() - elapsed),
        updatedAt: new Date(slid.updatedAt.getTime() - elapsed),
        authenticatedAt: new Date(slid.authenticatedAt.getTime() - elapsed),
      },
    });

    expect(await readSession(browser.headers, { refresh: true })).toBeNull();
    expect(await row(browser.sessionId)).toBeNull();
  });

  it("is never cut to fifteen minutes by the keep-alive", async () => {
    const browser = await signIn({ rememberMe: true });
    const before = (await row(browser.sessionId))!.expiresAt;

    const answer = await keepAlive(browser);

    expect(answer?.kind).toBe("idle");
    expect(answer?.expires).toBe(before.toISOString());
    expect((await row(browser.sessionId))!.expiresAt).toEqual(before);
  });

  it("is never given a time already past by the keep-alive, minutes from its year", async () => {
    // Ten minutes from the year's limit, written within the day: nothing
    // slides it, and the browser formula would answer with a day long gone.
    const browser = await signIn({ rememberMe: true });
    const now = Date.now();
    const limit = now + 10 * MINUTE;
    await prisma.session.update({
      where: { id: browser.sessionId },
      data: {
        authenticatedAt: new Date(limit - REMEMBERED_CAP_S * 1000),
        expiresAt: new Date(limit),
        updatedAt: new Date(now - MINUTE),
      },
    });

    const answer = await keepAlive(browser);

    expect(answer?.kind).toBe("cap");
    expect(answer?.expires).toBe(new Date(limit).toISOString());
    expect((await row(browser.sessionId))!.expiresAt.getTime()).toBe(limit);
  });

  it("is what a ticked sign-in gets in a browser an unticked one left its dont_remember in", async () => {
    // Better Auth sets `dont_remember` for an unticked sign-in and never
    // clears it; while the browser holds it, Better Auth refreshes nothing
    // there. A ticked sign-in in the same browser must clear it.
    const first = await signIn({ rememberMe: false });
    const jar = first.headers.get("cookie")!;
    expect(jar).toMatch(/stoky\.dont_remember=/);
    await prisma.session.update({
      where: { id: first.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const second = await signIn({ rememberMe: true, cookie: jar });

    expect((await row(second.sessionId))!.persistent).toBe(true);
    expect(second.setCookie).toContainEqual(expect.stringMatching(/^stoky\.dont_remember=; Max-Age=0;/));
    expect(second.headers.get("cookie")).not.toMatch(/dont_remember/);

    // And with the browser's jar as it now stands, the daily slide happens.
    await used(second.sessionId, { usedAgoMs: DAY + 1000, authenticatedAgoMs: 2 * DAY });
    const before = Date.now();
    expect(await readSession(second.headers, { refresh: true })).not.toBeNull();
    expect((await row(second.sessionId))!.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + REMEMBERED_IDLE_S * 1000 - 1000,
    );
  });
});

describe("a read of a session that has gone (D144)", () => {
  const SESSION_COOKIE = "stoky.session_token";
  const DONT_REMEMBER = "stoky.dont_remember";

  /** Whether `lines` expire the cookie called `name`. */
  const expires = (lines: string[], name: string) =>
    lines.some((line) => line.startsWith(`${name}=`) && (/;\s*max-age=0\b/i.test(line) || line.startsWith(`${name}=;`)));

  /** A browser session whose row has just been deleted, as a password change deletes it. */
  async function goneSession(): Promise<Headers> {
    const browser = await signIn({ rememberMe: false });
    expect(browser.headers.get("cookie")).toContain(`${DONT_REMEMBER}=`);
    await prisma.session.delete({ where: { id: browser.sessionId } });
    return browser.headers;
  }

  it("answers no session and leaves the browser's cookies alone, read as the tRPC route reads it", async () => {
    // A request sent with this device's old cookie just before its password
    // change replaced it is read after the row went. Its expiring cookies,
    // copied into its answer by `nextCookies`, would sign the device out if
    // that answer arrived after the rotation's.
    const headers = await goneSession();

    const read = await getAuth().api.getSession({
      headers,
      query: { disableRefresh: true },
      returnHeaders: true,
    });

    expect(read.response).toBeNull();
    const lines = read.headers?.getSetCookie() ?? [];
    expect(expires(lines, SESSION_COOKIE), lines.join("\n")).toBe(false);
    expect(expires(lines, DONT_REMEMBER), lines.join("\n")).toBe(false);
    expect(await readSession(headers, { refresh: true })).toBeNull();
  });

  it("does the same through the auth API's get-session", async () => {
    const headers = await goneSession();
    const { GET } = await import("@/app/api/auth/[...all]/route");

    const response = await GET(
      new Request(`${testOrigin()}/api/auth/get-session`, { headers }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    const lines = response.headers.getSetCookie();
    expect(expires(lines, SESSION_COOKIE), lines.join("\n")).toBe(false);
    expect(expires(lines, DONT_REMEMBER), lines.join("\n")).toBe(false);
  });

  it("still lets a sign-out clear them", async () => {
    // The control: the cookies can still be expired, by the one request that
    // means to.
    const browser = await signIn({ rememberMe: false });
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const headers = new Headers(browser.headers);
    headers.set("origin", testOrigin());
    headers.set("content-type", "application/json");

    const response = await POST(
      new Request(`${testOrigin()}/api/auth/sign-out`, { method: "POST", headers, body: "{}" }),
    );

    expect(response.status).toBe(200);
    expect(expires(response.headers.getSetCookie(), SESSION_COOKIE)).toBe(true);
  });
});
