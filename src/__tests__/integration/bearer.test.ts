import { afterAll, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { readSession } from "@/lib/auth";
import { resolveSecret } from "@/lib/auth/instance";
import { BROWSER_IDLE_S, REMEMBERED_CAP_S } from "@/lib/auth/session-policy";
import { prisma } from "@/lib/prisma";
import { createTrpcHandler } from "@/server/http/trpc-handler";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { signInWith, testOrigin } from "../utils/authorize";
import { createTestUser, generateTestEmail } from "../utils/test-helpers";

/**
 * A native client, as the iOS app will be one (PROGRESS D142): no cookie
 * store, no `Origin`, no Fetch Metadata. It signs in at `/sign-in/email` with
 * `rememberMe: true`, reads the session from the `set-auth-token` header, and
 * sends it back on every request as `Authorization: Bearer <token>.<signature>`
 * — to the auth API and to tRPC alike.
 *
 * Everything runs through the real route, the real Better Auth and the real
 * rows. Each test has its own account, so the ten-session cap (D140) cannot
 * reach from one test into another.
 */

const PASSWORD = "cocina despensa nevera";
const MARKER = `bearer-${process.pid}-${Date.now().toString(36)}`;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: MARKER } } });
});

async function account(): Promise<{ email: string; userId: string }> {
  const email = generateTestEmail(MARKER);
  const user = await createTestUser({
    email,
    name: `Bearer ${MARKER}`,
    password: PASSWORD,
  });
  return { email, userId: user.id };
}

/** A sign-in the way the native client makes it: no cookie, no `Origin`. */
async function nativeSignIn(email: string, rememberMe: boolean = true) {
  const answer = await signInWith({ email, password: PASSWORD, rememberMe });
  expect(answer.status).toBe(200);
  const token = answer.headers.get("set-auth-token");
  if (!token) throw new Error("a native sign-in was given no set-auth-token");
  return { answer, token, bearer: { authorization: `Bearer ${token}` } };
}

/** The raw token the database holds, from the signed one the client holds. */
function rawToken(signed: string): string {
  return decodeURIComponent(signed).split(".")[0];
}

const rowByToken = (signed: string) =>
  prisma.session.findUnique({ where: { token: rawToken(signed) } });

function getSession(headers: HeadersInit): Promise<Response> {
  return GET(new Request(`${testOrigin()}/api/auth/get-session`, { headers }));
}

async function sessionUserId(headers: HeadersInit): Promise<string | null> {
  const response = await getSession(headers);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user?: { id?: string } } | null;
  return body?.user?.id ?? null;
}

/** `auth.me` through the tRPC endpoint, its session read the way the route reads it. */
function protectedQuery(headers: HeadersInit): Promise<Response> {
  const request = new Request(`${testOrigin()}/api/trpc/auth.me`, { headers });
  return createTrpcHandler({
    router: appRouter,
    getSession: () => readSession(request.headers, { refresh: true }),
    createContext: createTRPCContext,
  })(request);
}

describe("a native sign-in", () => {
  it("answers a cookie-less, Origin-less sign-in with the signed token in set-auth-token, and only there", async () => {
    const { email } = await account();
    const { answer, token } = await nativeSignIn(email);

    // token.signature: the database's token and its HMAC, which is what the
    // bearer plugin accepts and the stored value alone is not.
    const [raw, signature] = decodeURIComponent(token).split(".");
    expect(raw).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(signature).toBeTruthy();
    expect(await rowByToken(token)).not.toBeNull();

    expect(answer.headers.get("access-control-expose-headers")).toContain(
      "set-auth-token",
    );
    expect(answer.body?.token).toBeUndefined();
    expect(JSON.stringify(answer.body)).not.toContain(raw);
  });

  it("is remembered when the client says rememberMe: true, as the contract asks", async () => {
    const { email } = await account();
    const { token } = await nativeSignIn(email);

    expect((await rowByToken(token))?.persistent).toBe(true);
  });

  it("never hands set-auth-token to a request that carried a cookie, or names it as exposed", async () => {
    // Any cookie at all: a browser always carries one here, and the token in
    // a header would be the HttpOnly cookie's value within a script's reach.
    const { email } = await account();
    for (const cookie of [
      "stoky_device=7d3e1c58-9a1f-4f5e-8a0e-3b2d1c4e5f60",
      "unrelated=1",
    ]) {
      const answer = await signInWith(
        { email, password: PASSWORD, rememberMe: true },
        { cookie },
      );

      expect(answer.status).toBe(200);
      expect(
        answer.setCookie.some((line) =>
          line.startsWith("stoky.session_token="),
        ),
      ).toBe(true);
      expect(answer.headers.get("set-auth-token")).toBeNull();
      expect(
        answer.headers.get("access-control-expose-headers") ?? "",
      ).not.toContain("set-auth-token");
    }
  });

  it("ends the session the client presented when it signs in again", async () => {
    // A bearer sign-in goes through /sign-in/email like any other, so the
    // tidy (D139) reads the session from the Authorization header too.
    const { email } = await account();
    const first = await nativeSignIn(email);
    const firstRow = await rowByToken(first.token);

    const again = await signInWith(
      { email, password: PASSWORD, rememberMe: true },
      { authorization: first.bearer.authorization },
    );

    expect(again.status).toBe(200);
    expect(
      await prisma.session.findUnique({ where: { id: firstRow!.id } }),
    ).toBeNull();
  });
});

describe("what a bearer token opens", () => {
  it("is the auth API's get-session", async () => {
    const { email, userId } = await account();
    const { bearer } = await nativeSignIn(email);

    expect(await sessionUserId(bearer)).toBe(userId);
  });

  it("is a protected tRPC query", async () => {
    const { email, userId } = await account();
    const { bearer } = await nativeSignIn(email);

    const response = await protectedQuery(bearer);

    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain(userId);
  });

  it("is not the token the database holds, without its signature", async () => {
    const { email } = await account();
    const { token } = await nativeSignIn(email);
    const unsigned = { authorization: `Bearer ${rawToken(token)}` };

    expect(await sessionUserId(unsigned)).toBeNull();
    expect((await protectedQuery(unsigned)).status).toBe(401);
  });

  it("is not a token signed with another key", async () => {
    const { email, userId } = await account();
    const { token } = await nativeSignIn(email);
    const raw = rawToken(token);
    // As better-call signs a cookie: HMAC-SHA256, in padded standard base64.
    const signedWith = (key: string) =>
      `Bearer ${raw}.${createHmac("sha256", key).update(raw).digest("base64")}`;

    // The control: the same construction with the instance's own key opens
    // the session, so the refusal below is the key and not the construction.
    expect(
      await sessionUserId({ authorization: signedWith(resolveSecret()) }),
    ).toBe(userId);

    const forged = {
      authorization: signedWith("another instance's secret, 32 chars+"),
    };
    expect(await sessionUserId(forged)).toBeNull();
    expect((await protectedQuery(forged)).status).toBe(401);
  });
});

describe("a native sign-out", () => {
  it("deletes the row, and the token opens nothing after it", async () => {
    const { email } = await account();
    const { token, bearer } = await nativeSignIn(email);

    const response = await POST(
      new Request(`${testOrigin()}/api/auth/sign-out`, {
        method: "POST",
        headers: { ...bearer, "content-type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);
    expect(await rowByToken(token)).toBeNull();
    expect(await sessionUserId(bearer)).toBeNull();
  });
});

describe("how long a bearer session lives", () => {
  it("slides a remembered one, and never past a year from the sign-in", async () => {
    // Signed in 364 days ago, last written a day and a second ago: the daily
    // refresh is due, and may reach a year from the sign-in and no further.
    const { email } = await account();
    const { token, bearer } = await nativeSignIn(email);
    const row = (await rowByToken(token))!;
    const now = Date.now();
    await prisma.session.update({
      where: { id: row.id },
      data: {
        authenticatedAt: new Date(now - 364 * DAY),
        updatedAt: new Date(now - DAY - 1000),
        expiresAt: new Date(now + MINUTE),
      },
    });

    expect((await protectedQuery(bearer)).status).toBe(200);

    const slid = (await rowByToken(token))!;
    expect(slid.updatedAt.getTime()).toBeGreaterThan(now - MINUTE);
    expect(slid.expiresAt.getTime()).toBe(
      slid.authenticatedAt.getTime() + REMEMBERED_CAP_S * 1000,
    );
  });

  it("never moves a browser-kind one, read through tRPC or the auth API", async () => {
    // Without the box the row is a browser session: fifteen idle minutes,
    // slid only by auth.session. A bearer request carries no dont_remember
    // cookie, so Better Auth thinks it remembered and proposes ninety days on
    // every get-session; the update hook must drop that.
    const { email } = await account();
    const { token, bearer } = await nativeSignIn(email, false);
    const before = (await rowByToken(token))!;
    expect(before.persistent).toBe(false);

    expect((await protectedQuery(bearer)).status).toBe(200);
    expect(await sessionUserId(bearer)).not.toBeNull();

    const after = (await rowByToken(token))!;
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
    expect(after.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + BROWSER_IDLE_S * 1000,
    );
  });
});
