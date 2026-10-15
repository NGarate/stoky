import { describe, expect, it, mock } from "bun:test";
import {
  readSessionExpiry,
  secondStepResultFrom,
  signInResultFrom,
  signInWithPassword,
  verifyBackupCode,
  verifyTotp,
} from "@/lib/auth/client";
import type { SecondStepRefusalCode } from "@/lib/auth/client";
import { getAuthErrorKey } from "@/lib/auth/error-messages";
import { SignInRefusedError } from "@/lib/auth/sign-in-policy";

/**
 * The browser's auth module, which turns the auth API's answers into ours.
 *
 * Its whole value is the translation: the forms read `SignInResult` and
 * nothing else, so a refusal the module flattens is a refusal no form can
 * word. The account limit read as "wrong password" is the case that matters —
 * the password was very likely right.
 */

describe("signInResultFrom", () => {
  it("reads a 200 as signed in", () => {
    expect(signInResultFrom(200, { user: { id: "u" } }, null)).toEqual({ ok: true });
  });

  it("reads a right password that asks for a code as not signed in yet", () => {
    // D148: Better Auth answers 200 with a challenge cookie and no session.
    // Read as signed in, the form would navigate to a screen that sends the
    // person straight back to /login.
    expect(
      signInResultFrom(200, { twoFactorRedirect: true, twoFactorMethods: ["totp"] }, null),
    ).toEqual({ ok: false, twoFactor: true });
    // Only the literal flag: anything else is the ordinary answer.
    expect(signInResultFrom(200, { twoFactorRedirect: "true" }, null)).toEqual({ ok: true });
  });

  it("calls Better Auth's refusal a wrong address or password", () => {
    expect(signInResultFrom(401, { code: "INVALID_EMAIL_OR_PASSWORD" }, null)).toEqual({
      ok: false,
      code: "invalid_credentials",
    });
    // Too long to check is still "wrong": naming the rule would help a guesser.
    expect(signInResultFrom(400, { code: "PASSWORD_TOO_LONG" }, null)).toEqual({
      ok: false,
      code: "invalid_credentials",
    });
  });

  it("passes every code the route refuses with, read off the server's own class", () => {
    // From SignInRefusedError rather than written out, so a renamed server
    // code cannot leave this passing against a code nothing sends. The route
    // sends it upper-cased (`auth-handler.ts`).
    for (const code of ["rate_limited", "account_rate_limited", "auth_unavailable"] as const) {
      const sent = new SignInRefusedError(code, null).code.toUpperCase();
      expect(signInResultFrom(429, { code: sent }, null)).toMatchObject({ ok: false, code });
    }
  });

  it("carries Retry-After, when it is a number of seconds", () => {
    expect(signInResultFrom(429, { code: "RATE_LIMITED" }, "437")).toEqual({
      ok: false,
      code: "rate_limited",
      retryAfterSeconds: 437,
    });
    expect(
      signInResultFrom(429, { code: "RATE_LIMITED" }, "Wed, 21 Oct 2026 07:28:00 GMT"),
    ).toEqual({ ok: false, code: "rate_limited" });
  });

  it("calls an origin the instance does not trust unavailable, not a wrong password", () => {
    for (const code of ["INVALID_ORIGIN", "MISSING_OR_NULL_ORIGIN"]) {
      expect(signInResultFrom(403, { code }, null)).toEqual({
        ok: false,
        code: "auth_unavailable",
      });
    }
  });

  it("does not pass through a code the forms have no words for", () => {
    expect(signInResultFrom(400, { code: "made_up" }, null)).toEqual({
      ok: false,
      code: "unknown",
    });
    expect(signInResultFrom(500, null, null)).toEqual({ ok: false, code: "unknown" });
    expect(signInResultFrom(404, "Not Found", null)).toEqual({ ok: false, code: "unknown" });
  });

  it("hands the forms codes they have words for", () => {
    // The point of the vocabulary: each refusal reaches its own message, and
    // none falls through to the generic one.
    expect(getAuthErrorKey(undefined, "login", "invalid_credentials")).toBe("invalidCredentials");
    expect(getAuthErrorKey(undefined, "login", "account_rate_limited")).toBe(
      "accountTooManyAttempts",
    );
    expect(getAuthErrorKey(undefined, "login", "unknown")).toBe("loginError");
  });
});

describe("signInWithPassword", () => {
  function answering(status: number, body: unknown, headers: Record<string, string> = {}) {
    return mock(async (_url: string, _init: RequestInit) =>
      Response.json(body, { status, headers }),
    );
  }

  it("posts JSON to the auth API, never from a cache", async () => {
    const fetcher = answering(200, { user: { id: "u" } });

    const result = await signInWithPassword(
      { email: "a@b.es", password: "secreta123", rememberMe: false },
      fetcher as unknown as typeof fetch,
    );

    expect(result).toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/auth/sign-in/email");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "a@b.es",
      password: "secreta123",
      rememberMe: false,
    });
    expect(init.cache).toBe("no-store");
  });

  it("says rememberMe in so many words, ticked or not", async () => {
    // Left out, Better Auth would read it as true; the route reads anything
    // but `true` as false. The body says which, both ways.
    for (const rememberMe of [true, false]) {
      const fetcher = answering(200, { user: { id: "u" } });
      await signInWithPassword(
        { email: "a@b.es", password: "x", rememberMe },
        fetcher as unknown as typeof fetch,
      );
      expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).rememberMe).toBe(rememberMe);
    }
  });

  it("returns the translated refusal with its wait", async () => {
    const fetcher = answering(429, { code: "ACCOUNT_RATE_LIMITED" }, { "retry-after": "812" });

    expect(
      await signInWithPassword(
        { email: "a@b.es", password: "x", rememberMe: false },
        fetcher as unknown as typeof fetch,
      ),
    ).toEqual({ ok: false, code: "account_rate_limited", retryAfterSeconds: 812 });
  });
});

describe("secondStepResultFrom", () => {
  it("reads a 200 as signed in", () => {
    expect(secondStepResultFrom(200, { token: null, user: { id: "u" } }, null)).toEqual({
      ok: true,
    });
  });

  it("names each refusal by what the person can do about it", () => {
    const cases: [string, SecondStepRefusalCode][] = [
      ["INVALID_CODE", "invalid_code"],
      ["INVALID_BACKUP_CODE", "invalid_backup_code"],
      // The challenge is gone: only the password step makes another.
      ["INVALID_TWO_FACTOR_COOKIE", "two_factor_expired"],
      ["TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", "two_factor_expired"],
      ["ACCOUNT_TEMPORARILY_LOCKED", "two_factor_locked"],
      // The TOTP guard's own (`policy-plugin.ts`).
      ["TWO_FACTOR_UNREADABLE", "two_factor_unreadable"],
      ["RATE_LIMITED", "rate_limited"],
      ["AUTH_UNAVAILABLE", "auth_unavailable"],
      ["INVALID_ORIGIN", "auth_unavailable"],
    ];
    for (const [sent, ours] of cases) {
      expect(secondStepResultFrom(401, { code: sent }, null), sent).toEqual({
        ok: false,
        code: ours,
      });
    }
  });

  it("does not read a password refusal as a code refusal, or pass an unknown one through", () => {
    expect(secondStepResultFrom(401, { code: "INVALID_EMAIL_OR_PASSWORD" }, null)).toEqual({
      ok: false,
      code: "unknown",
    });
    expect(secondStepResultFrom(500, null, null)).toEqual({ ok: false, code: "unknown" });
  });

  it("carries Retry-After", () => {
    expect(secondStepResultFrom(429, { code: "RATE_LIMITED" }, "30")).toEqual({
      ok: false,
      code: "rate_limited",
      retryAfterSeconds: 30,
    });
  });

  it("hands the form codes it has words for", () => {
    const words = (code: string) => getAuthErrorKey(undefined, "login", code);
    expect(words("invalid_code")).toBe("twoFactorInvalidCode");
    expect(words("invalid_backup_code")).toBe("backupCodeInvalid");
    expect(words("two_factor_expired")).toBe("twoFactorExpired");
    expect(words("two_factor_locked")).toBe("twoFactorLocked");
    expect(words("two_factor_unreadable")).toBe("twoFactorUnreadable");
  });
});

describe("verifyTotp and verifyBackupCode", () => {
  function answering(status: number, body: unknown) {
    return mock(async (_url: string, _init: RequestInit) => Response.json(body, { status }));
  }

  for (const [name, call, path] of [
    ["verifyTotp", verifyTotp, "/api/auth/two-factor/verify-totp"],
    ["verifyBackupCode", verifyBackupCode, "/api/auth/two-factor/verify-backup-code"],
  ] as const) {
    it(`${name} posts the code and nothing else, never from a cache`, async () => {
      const fetcher = answering(200, { token: null, user: { id: "u" } });

      expect(await call("ab12 cd34", fetcher as unknown as typeof fetch)).toEqual({ ok: true });
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe(path);
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("content-type")).toBe("application/json");
      // As typed: the server normalises a backup code (D149).
      expect(JSON.parse(String(init.body))).toEqual({ code: "ab12 cd34" });
      expect(init.cache).toBe("no-store");
      expect(init.credentials).toBe("same-origin");
    });
  }

  it("returns the translated refusal", async () => {
    const fetcher = answering(401, { code: "INVALID_TWO_FACTOR_COOKIE" });
    expect(await verifyTotp("123456", fetcher as unknown as typeof fetch)).toEqual({
      ok: false,
      code: "two_factor_expired",
    });
  });
});

describe("readSessionExpiry", () => {
  function answering(body: unknown, status = 200) {
    return mock(async (_url: string, _init: RequestInit) => Response.json(body, { status }));
  }

  it("reads the expiry auth.session answered, never from a cache", async () => {
    const fetcher = answering({
      result: { data: { json: { expires: "2026-10-15T12:00:00.000Z", kind: "idle" } } },
    });

    expect(await readSessionExpiry(fetcher as unknown as typeof fetch)).toEqual({
      expires: "2026-10-15T12:00:00.000Z",
      kind: "idle",
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/trpc/auth.session");
    expect(init.cache).toBe("no-store");
  });

  it("passes on that the expiry is the day's limit", async () => {
    const fetcher = answering({
      result: { data: { json: { expires: "2026-10-15T12:00:00.000Z", kind: "cap" } } },
    });

    expect(await readSessionExpiry(fetcher as unknown as typeof fetch)).toEqual({
      expires: "2026-10-15T12:00:00.000Z",
      kind: "cap",
    });
  });

  it("reads anything but an explicit limit as the idle deadline", async () => {
    // Wrong one way, the warning offers a button that changes nothing; wrong
    // the other, it hides one that works. The first is the cheaper mistake.
    for (const kind of ["idle", "CAP", 1, undefined]) {
      const fetcher = answering({
        result: { data: { json: { expires: "2026-10-15T12:00:00.000Z", kind } } },
      });
      expect((await readSessionExpiry(fetcher as unknown as typeof fetch))?.kind).toBe("idle");
    }
  });

  it("answers null when there is no session", async () => {
    expect(
      await readSessionExpiry(answering({ result: { data: { json: null } } }) as unknown as typeof fetch),
    ).toBeNull();
  });

  it("throws on a failed request, so the caller can tell it from a signed-out answer", async () => {
    const failing = mock(async () => {
      throw new Error("offline");
    });
    await expect(readSessionExpiry(failing as unknown as typeof fetch)).rejects.toThrow("offline");

    await expect(
      readSessionExpiry(answering({ error: {} }, 500) as unknown as typeof fetch),
    ).rejects.toThrow("500");
  });
});
