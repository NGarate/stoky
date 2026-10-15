import { describe, expect, it, mock } from "bun:test";
import {
  readSessionExpiry,
  signInResultFrom,
  signInWithPassword,
} from "@/lib/auth/client";
import { getAuthErrorKey } from "@/lib/auth/error-messages";
import { SignInRefusedError } from "@/lib/auth/sign-in-policy";

/**
 * The browser's auth module, which turns the library's answers into ours.
 *
 * Its whole value is the translation: the forms read `SignInResult` and
 * nothing else, so a refusal the module flattens is a refusal no form can
 * word. The account limit read as "wrong password" is the case that matters —
 * the password was very likely right.
 */

/** next-auth's answer to a credentials sign-in, as `signIn` resolves it. */
function nextAuthAnswer(error: string | undefined, code: string | undefined) {
  return { error, code, status: 200, ok: true, url: error ? null : "http://localhost/" };
}

describe("signInResultFrom", () => {
  it("passes a rate-limit code through rather than calling it a wrong password", () => {
    expect(signInResultFrom(nextAuthAnswer("CredentialsSignin", "rate_limited"))).toEqual({
      ok: false,
      code: "rate_limited",
    });
  });

  it("passes every code the server refuses with, read off the server's own class", () => {
    // From SignInRefusedError rather than written out, so a renamed server
    // code cannot leave this passing against a code nothing sends.
    for (const code of ["rate_limited", "account_rate_limited", "auth_unavailable"] as const) {
      const sent = new SignInRefusedError(code, null).code;
      expect(signInResultFrom(nextAuthAnswer("CredentialsSignin", sent))).toEqual({
        ok: false,
        code,
      });
    }
  });

  it("calls a plain refusal a wrong address or password", () => {
    // `credentials` is next-auth's default code for CredentialsSignin.
    expect(signInResultFrom(nextAuthAnswer("CredentialsSignin", "credentials"))).toEqual({
      ok: false,
      code: "invalid_credentials",
    });
  });

  it("does not pass through a code the forms have no words for", () => {
    // The code arrives in a query string; an unknown one is a plain refusal.
    expect(signInResultFrom(nextAuthAnswer("CredentialsSignin", "made_up"))).toEqual({
      ok: false,
      code: "invalid_credentials",
    });
    expect(signInResultFrom(nextAuthAnswer("Configuration", undefined))).toEqual({
      ok: false,
      code: "unknown",
    });
  });

  it("treats no answer at all as a failure, never as a sign-in", () => {
    expect(signInResultFrom(undefined)).toEqual({ ok: false, code: "unknown" });
  });

  it("reads an answer with no error as signed in", () => {
    expect(signInResultFrom(nextAuthAnswer(undefined, undefined))).toEqual({ ok: true });
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
  it("asks for the credentials provider without a redirect", async () => {
    const signIn = mock(async () => nextAuthAnswer(undefined, undefined));

    const result = await signInWithPassword({ email: "a@b.es", password: "secreta123" }, signIn);

    // `redirect: false` is what keeps the decision of where to go with the
    // form, which sends a signed-in person to `/` and its screen choice.
    expect(signIn).toHaveBeenCalledWith("credentials", {
      email: "a@b.es",
      password: "secreta123",
      redirect: false,
    });
    expect(result).toEqual({ ok: true });
  });

  it("returns the translated refusal", async () => {
    const signIn = mock(async () => nextAuthAnswer("CredentialsSignin", "account_rate_limited"));

    expect(await signInWithPassword({ email: "a@b.es", password: "x" }, signIn)).toEqual({
      ok: false,
      code: "account_rate_limited",
    });
  });
});

describe("readSessionExpiry", () => {
  function answering(body: unknown) {
    return mock(async () => ({ json: async () => body }) as unknown as Response);
  }

  it("reads the expiry the server re-issued, never from a cache", async () => {
    const fetcher = answering({ expires: "2026-10-15T12:00:00.000Z", user: { id: "u" } });

    expect(await readSessionExpiry(fetcher as unknown as typeof fetch)).toEqual({
      expires: "2026-10-15T12:00:00.000Z",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/auth/session", { cache: "no-store" });
  });

  it("answers null when there is no session", async () => {
    expect(await readSessionExpiry(answering(null) as unknown as typeof fetch)).toBeNull();
    expect(await readSessionExpiry(answering({}) as unknown as typeof fetch)).toBeNull();
  });

  it("lets a failed request throw, so the caller can tell it from a signed-out answer", async () => {
    const failing = mock(async () => {
      throw new Error("offline");
    });

    await expect(readSessionExpiry(failing as unknown as typeof fetch)).rejects.toThrow("offline");
  });
});
