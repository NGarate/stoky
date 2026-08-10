import { describe, it, expect } from "bun:test";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import { authConfig } from "@/lib/auth";

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
      token: { sub: "user-1", householdId: "house-1", role: "ADMIN" } as JWT,
    });

    expect(token.role).toBe("ADMIN");
  });

  it("treats a token minted before roles existed as the least privileged", async () => {
    const session = await runSession({
      session: emptySession(),
      token: { sub: "user-1", householdId: "house-1" } as JWT,
    });

    // Not MEMBER: an old token must not be able to outrank a new one. It
    // expires within the 15-minute session maxAge either way.
    expect(session.user.role).toBe("KITCHEN");
  });
});
