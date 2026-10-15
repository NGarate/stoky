import { describe, expect, it, mock } from "bun:test";
import {
  AccountChangeRefusedError,
  addPasskey,
  browserRefusalOf,
  listPasskeys,
  readSessionExpiry,
  removePasskey,
  renamePasskey,
  replaceBackupCodes,
  startTotpEnrolment,
  turnOffTwoFactor,
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

describe("changing two-step verification", () => {
  function answering(status: number, body: unknown, headers: Record<string, string> = {}) {
    return mock(async (_url: string, _init: RequestInit) => Response.json(body, { status, headers }));
  }
  const URI = "otpauth://totp/Stoky:ana%40example.com?secret=GEZDGNBV&issuer=Stoky&digits=6&period=30";
  const CODES = ["AAAA-BBBB-CCCC-DDDD-EEEE-FFFF", "GGGG-HHHH-JJJJ-KKKK-MMMM-NNNN"];

  for (const [name, call, path, answer] of [
    ["startTotpEnrolment", startTotpEnrolment, "/api/auth/two-factor/enable", { method: "totp", totpURI: URI, backupCodes: CODES }],
    ["turnOffTwoFactor", turnOffTwoFactor, "/api/auth/two-factor/disable", { status: true }],
    ["replaceBackupCodes", replaceBackupCodes, "/api/auth/two-factor/generate-backup-codes", { status: true, backupCodes: CODES }],
  ] as const) {
    it(`${name} posts the password and nothing else, never from a cache`, async () => {
      const fetcher = answering(200, answer);

      await call("cocina despensa", fetcher as unknown as typeof fetch);

      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe(path);
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(String(init.body))).toEqual({ password: "cocina despensa" });
      expect(init.cache).toBe("no-store");
      expect(init.credentials).toBe("same-origin");
    });

    it(`${name} throws the refusal, worded, with its wait`, async () => {
      const cases = [
        [400, "INVALID_PASSWORD", "wrong_password"],
        [400, "PASSWORD_TOO_LONG", "wrong_password"],
        [429, "REAUTH_RATE_LIMITED", "too_many_attempts"],
        [401, "UNAUTHORIZED", "signed_out"],
        [400, "TOTP_ALREADY_ENABLED", "already_enabled"],
        [400, "TWO_FACTOR_NOT_ENABLED", "not_enabled"],
        [503, "AUTH_UNAVAILABLE", "auth_unavailable"],
        [500, "SOMETHING_ELSE", "unknown"],
      ] as const;
      for (const [status, code, expected] of cases) {
        const fetcher = answering(status, { code }, { "retry-after": "30" });
        const refusal = await call("x", fetcher as unknown as typeof fetch).then(
          () => null,
          (error: unknown) => error,
        );
        expect(refusal, code).toBeInstanceOf(AccountChangeRefusedError);
        expect((refusal as AccountChangeRefusedError).code, code).toBe(expected);
        expect((refusal as AccountChangeRefusedError).retryAfterSeconds, code).toBe(30);
      }
    });
  }

  it("hands back the authenticator's address and the codes, once", async () => {
    expect(
      await startTotpEnrolment("x", answering(200, { method: "totp", totpURI: URI, backupCodes: CODES }) as unknown as typeof fetch),
    ).toEqual({ totpUri: URI, backupCodes: CODES });
    expect(
      await replaceBackupCodes("x", answering(200, { status: true, backupCodes: CODES }) as unknown as typeof fetch),
    ).toEqual(CODES);
  });

  it("refuses an answer that is not what it should be rather than show half of it", async () => {
    for (const [call, body] of [
      [startTotpEnrolment, { method: "otp" }],
      [startTotpEnrolment, { totpURI: "https://example.com", backupCodes: CODES }],
      [startTotpEnrolment, { totpURI: URI, backupCodes: [] }],
      [replaceBackupCodes, { status: true }],
      [replaceBackupCodes, { status: true, backupCodes: [1, 2] }],
    ] as const) {
      const refusal = await call("x", answering(200, body) as unknown as typeof fetch).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refusal, JSON.stringify(body)).toBeInstanceOf(AccountChangeRefusedError);
    }
  });
});

describe("passkeys", () => {
  /** A fetch that answers each call in turn, and records them. */
  function answeringInTurn(...answers: [number, unknown][]) {
    let call = 0;
    return mock(async (_url: string, _init: RequestInit) => {
      const [status, body] = answers[Math.min(call++, answers.length - 1)];
      return Response.json(body, { status });
    });
  }
  const ROW = {
    id: "pk-1",
    name: "Chrome en Android",
    userId: "u-1",
    publicKey: "pAEC…",
    credentialID: "cred-1",
    counter: 0,
    deviceType: "multiDevice",
    backedUp: true,
    transports: "internal,hybrid",
    aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
    createdAt: "2026-10-15T09:00:00.000Z",
  };

  it("lists the passkeys with what the screen shows, and nothing it does not", async () => {
    const older = { ...ROW, id: "pk-0", name: "  ", backedUp: false, createdAt: "2026-10-14T09:00:00.000Z" };
    const fetcher = answeringInTurn([200, [ROW, older]]);

    const listed = await listPasskeys(fetcher as unknown as typeof fetch);

    // No public key, credential id or counter: none of it means anything to
    // a person, so none of it is kept. Oldest first; a blank name is none.
    expect(listed).toEqual([
      { id: "pk-0", name: null, createdAt: older.createdAt, synced: false },
      { id: "pk-1", name: "Chrome en Android", createdAt: ROW.createdAt, synced: true },
    ]);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/auth/passkey/list-user-passkeys");
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
  });

  it("adds one in three steps: the options, the browser, the check", async () => {
    const options = { challenge: "c", rp: { id: "stoky.example" }, user: { id: "u" } };
    const fetcher = answeringInTurn([200, options], [200, { id: "pk-2" }]);
    const create = mock(async (_options: unknown) => ({
      id: "cred",
      rawId: "cred",
      response: { clientDataJSON: "x", attestationObject: "y" },
      type: "public-key",
      clientExtensionResults: { credProps: { rk: true } },
    }));

    await addPasskey("Firefox en Linux", { fetcher: fetcher as unknown as typeof fetch, create });

    expect(create.mock.calls[0][0]).toEqual(options);
    const [optionsUrl, optionsInit] = fetcher.mock.calls[0];
    expect(optionsUrl).toBe("/api/auth/passkey/generate-register-options");
    expect(optionsInit.method).toBe("GET");
    const [verifyUrl, verifyInit] = fetcher.mock.calls[1];
    expect(verifyUrl).toBe("/api/auth/passkey/verify-registration");
    expect(verifyInit.method).toBe("POST");
    // The answer and the name, as the route forwards them, and nothing else.
    expect(JSON.parse(String(verifyInit.body))).toEqual({
      response: {
        id: "cred",
        rawId: "cred",
        response: { clientDataJSON: "x", attestationObject: "y" },
        type: "public-key",
      },
      name: "Firefox en Linux",
    });
  });

  it("asks the browser for nothing when the options are refused", async () => {
    const fetcher = answeringInTurn([403, { code: "STEP_UP_REQUIRED" }]);
    const create = mock(async () => ({}));

    const refusal = await addPasskey(null, { fetcher: fetcher as unknown as typeof fetch, create }).then(
      () => null,
      (error: unknown) => error,
    );

    expect((refusal as AccountChangeRefusedError).code).toBe("step_up_required");
    expect(create).not.toHaveBeenCalled();
  });

  it("words the browser's refusal, and sends nothing after it", async () => {
    const fetcher = answeringInTurn([200, { challenge: "c" }]);
    const cancelled = Object.assign(new Error("The operation either timed out or was not allowed."), {
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    });
    const refusal = await addPasskey(null, {
      fetcher: fetcher as unknown as typeof fetch,
      create: async () => {
        throw cancelled;
      },
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect((refusal as AccountChangeRefusedError).code).toBe("cancelled");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reads the browser's errors as the screen words them", () => {
    expect(browserRefusalOf({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" })).toBe("already_registered");
    expect(browserRefusalOf({ code: "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT" })).toBe(
      "not_verified",
    );
    expect(browserRefusalOf({ code: "ERROR_CEREMONY_ABORTED" })).toBe("cancelled");
    expect(browserRefusalOf({ name: "NotAllowedError" })).toBe("cancelled");
    expect(browserRefusalOf(new Error("anything else"))).toBe("unknown");
  });

  it("renames and removes by id, posting only what each endpoint takes", async () => {
    const renamed = answeringInTurn([200, { passkey: ROW }]);
    await renamePasskey("pk-1", "Llavero", renamed as unknown as typeof fetch);
    expect(renamed.mock.calls[0][0]).toBe("/api/auth/passkey/update-passkey");
    expect(JSON.parse(String(renamed.mock.calls[0][1].body))).toEqual({ id: "pk-1", name: "Llavero" });

    const removed = answeringInTurn([200, { status: true }]);
    await removePasskey("pk-1", removed as unknown as typeof fetch);
    expect(removed.mock.calls[0][0]).toBe("/api/auth/passkey/delete-passkey");
    expect(JSON.parse(String(removed.mock.calls[0][1].body))).toEqual({ id: "pk-1" });
  });

  it("throws each endpoint's refusal, worded", async () => {
    const cases = [
      [403, "STEP_UP_REQUIRED", "step_up_required"],
      [401, "USER_VERIFICATION_REQUIRED", "not_verified"],
      [400, "PREVIOUSLY_REGISTERED", "already_registered"],
      [404, "PASSKEY_NOT_FOUND", "passkey_gone"],
      [401, "YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY", "passkey_gone"],
      [401, "UNAUTHORIZED", "signed_out"],
      [400, "FAILED_TO_VERIFY_REGISTRATION", "unknown"],
    ] as const;
    for (const [status, code, expected] of cases) {
      const refusal = await removePasskey(
        "pk-1",
        answeringInTurn([status, { code }]) as unknown as typeof fetch,
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect((refusal as AccountChangeRefusedError).code, code).toBe(expected);
    }
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
