import { describe, it, expect, spyOn } from "bun:test";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import { authConfig, MAX_SESSION_AGE_S } from "@/lib/auth";

/**
 * The role has to survive two hops before a procedure can check it: the
 * `authorize` result into the JWT, and the JWT into the session. Both are pure
 * functions of their arguments, so they belong in the cheapest tier that can
 * answer the question honestly (PROGRESS.md D25) rather than in a browser.
 *
 * What this cannot see is whether the *token* is trustworthy — that is Auth.js
 * signing it, and it is not this project's code.
 */

const jwtCallback = authConfig.callbacks!.jwt!;
const sessionCallback = authConfig.callbacks!.session!;

// The callbacks take a wide union in Auth.js v5; these helpers keep the casts
// in one place instead of at every call site.
const runJwt = (args: { token: JWT; user?: unknown }) =>
  (jwtCallback as (a: unknown) => Promise<JWT>)(args);

const runSession = (args: { session: Session; token: JWT }) =>
  (sessionCallback as (a: unknown) => Promise<Session>)(args);

const nowS = () => Math.floor(Date.now() / 1000);

const emptySession = (): Session =>
  ({
    user: { id: "", email: "u@example.com", name: "U", role: "MEMBER" },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  }) as Session;

describe("auth session callbacks", () => {
  it("carries the role from the authorize result into the token", async () => {
    const token = await runJwt({
      token: { sub: "user-1" } as JWT,
      user: { id: "user-1", householdId: "house-1", role: "KITCHEN" },
    });

    expect(token.role).toBe("KITCHEN");
    expect(token.householdId).toBe("house-1");
  });

  it("carries the role from the token into the session", async () => {
    const session = await runSession({
      session: emptySession(),
      token: { sub: "user-1", householdId: "house-1", role: "ADMIN" } as JWT,
    });

    expect(session.user.role).toBe("ADMIN");
    expect(session.user.id).toBe("user-1");
    expect(session.user.householdId).toBe("house-1");
  });

  it("leaves an existing token untouched when there is no user to read", async () => {
    // Every request after sign-in calls `jwt` with no `user`. If that path
    // cleared the role, a session would be authorised on its first request and
    // refused on its second.
    const token = await runJwt({
      token: {
        sub: "user-1",
        householdId: "house-1",
        role: "ADMIN",
        authTime: nowS(),
      } as JWT,
    });

    expect(token.role).toBe("ADMIN");
  });

  it("treats a token minted before roles existed as the least privileged", async () => {
    const session = await runSession({
      session: emptySession(),
      token: { sub: "user-1", householdId: "house-1" } as JWT,
    });

    // Not MEMBER: an old token must not be able to outrank a new one. The
    // `jwt` callback refuses it first, having no `authTime` either.
    expect(session.user.role).toBe("KITCHEN");
  });
});

/**
 * The absolute lifetime. Every read of the session re-issues the token with a
 * fresh `iat` and a fresh fifteen-minute expiry, so without a claim that
 * records the sign-in itself a session in use never ended — security review
 * 2026-10-12. None of these tokens carries an `iat`, so the callback answers
 * them without reaching the database: the lifetime check sits before the
 * revocation query on purpose, and these cases are what would notice it
 * moving after.
 */
describe("the absolute session lifetime", () => {
  const DAY_S = 24 * 60 * 60;

  it("is thirty days", () => {
    // Pinned so that a change to the number is a change to this file too,
    // and SECURITY.md, which states it, is read in the same review.
    expect(MAX_SESSION_AGE_S).toBe(30 * DAY_S);
  });

  it("starts at sign-in, which stamps the time the password was typed", async () => {
    const before = nowS();
    const token = await runJwt({
      token: { sub: "user-1" } as JWT,
      user: { id: "user-1", householdId: "house-1", role: "MEMBER" },
    });
    const after = nowS();

    expect(typeof token.authTime).toBe("number");
    expect(token.authTime as number).toBeGreaterThanOrEqual(before);
    expect(token.authTime as number).toBeLessThanOrEqual(after);
  });

  it("keeps a session signed in a moment ago", async () => {
    const token = await runJwt({
      token: { sub: "user-1", role: "MEMBER", authTime: nowS() } as JWT,
    });

    expect(token).not.toBeNull();
  });

  it("keeps a session signed in a day short of the limit", async () => {
    // The other side of the line, far enough from it that the clock moving
    // between building the token and checking it cannot decide the result.
    const token = await runJwt({
      token: {
        sub: "user-1",
        role: "MEMBER",
        authTime: nowS() - MAX_SESSION_AGE_S + DAY_S,
      } as JWT,
    });

    expect(token).not.toBeNull();
  });

  it("refuses a session signed in thirty days and a second ago, and says why", async () => {
    // `null`, not an empty token: `@auth/core/lib/actions/session.js` clears
    // the cookies on exactly that value.
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    let token: JWT | null;
    let lines: unknown[];
    try {
      token = await runJwt({
        token: {
          sub: "user-1",
          role: "MEMBER",
          authTime: nowS() - MAX_SESSION_AGE_S - 1,
        } as JWT,
      });
    } finally {
      // Read before restoring, which clears what the spy recorded.
      lines = warn.mock.calls.map((call) => JSON.parse(String(call[0])));
      warn.mockRestore();
    }

    expect(token).toBeNull();
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "auth.session.revoked",
        reason: "absolute-lifetime",
        userId: "user-1",
      }),
    );
  });

  it("refuses a session with no sign-in time, rather than starting its clock now", async () => {
    // Issued before the claim existed, so its age is unknown. Stamping it here
    // would give a token stolen before the upgrade a fresh thirty days.
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    let token: JWT | null;
    try {
      token = await runJwt({
        token: { sub: "user-1", householdId: "house-1", role: "ADMIN" } as JWT,
      });
    } finally {
      warn.mockRestore();
    }

    expect(token).toBeNull();
  });
});
