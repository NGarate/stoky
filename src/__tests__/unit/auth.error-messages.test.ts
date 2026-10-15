import { describe, expect, it } from "bun:test";
import { getAuthErrorKey } from "@/lib/auth/error-messages";
import { SignInRefusedError } from "@/lib/auth/sign-in-policy";
import { registerSchema } from "@/lib/validations/auth";
import { REGISTRATION_CLOSED_MESSAGE } from "@/lib/auth/registration";

describe("getAuthErrorKey", () => {
  it("maps a wrong address or password to invalid credentials", () => {
    expect(getAuthErrorKey("Invalid email or password", "login")).toBe(
      "invalidCredentials",
    );
    expect(getAuthErrorKey(undefined, "login", "INVALID_EMAIL_OR_PASSWORD")).toBe(
      "invalidCredentials",
    );
    // Too long to check is still "wrong": naming the rule would help a guesser.
    expect(getAuthErrorKey(undefined, "login", "PASSWORD_TOO_LONG")).toBe(
      "invalidCredentials",
    );
  });

  it("calls an untrusted origin unavailable, which is the instance's doing", () => {
    expect(getAuthErrorKey(undefined, "login", "INVALID_ORIGIN")).toBe("authUnavailable");
    expect(getAuthErrorKey(undefined, "login", "MISSING_OR_NULL_ORIGIN")).toBe(
      "authUnavailable",
    );
  });

  it("maps duplicate account errors to email exists", () => {
    expect(getAuthErrorKey("Email already registered", "register")).toBe(
      "emailExists",
    );
    expect(
      getAuthErrorKey(
        "Unique constraint failed on the fields: (`email`)",
        "register",
      ),
    ).toBe("emailExists");
  });

  it("names the identity rule rather than asking to check the details", () => {
    // The message tRPC sends for a refused input is the ZodError's JSON, so
    // the test feeds the real one rather than a string written to match.
    const refused = registerSchema.safeParse({
      email: "noel@example.com",
      name: "Noel",
      password: "noel en la cocina",
    });

    expect(getAuthErrorKey(refused.error?.message, "register")).toBe(
      "passwordContainsIdentity",
    );
  });

  it("says registration is closed rather than asking to check the details", () => {
    // The exact constant `auth.register` refuses with — no detail the person
    // could change would get them in, so "check the details" would be a lie.
    expect(getAuthErrorKey(REGISTRATION_CLOSED_MESSAGE, "register")).toBe(
      "registrationClosed",
    );
  });

  it("still calls any other refused input a generic failure", () => {
    const refused = registerSchema.safeParse({
      email: "ana@example.com",
      name: "Ana",
      password: "short",
    });

    expect(getAuthErrorKey(refused.error?.message, "register")).toBe(
      "registerError",
    );
  });

  it("tells an account refusal from an address refusal", () => {
    // The codes are read off the class the sign-in policy throws, so renaming
    // one cannot leave this passing against a code the server no longer sends.
    // "From this connection" is right for the address limit and wrong for the
    // account's: another network cannot help, and the person may be the one
    // somebody else is locking out.
    expect(
      getAuthErrorKey(undefined, "login", new SignInRefusedError("rate_limited", 1).code),
    ).toBe("tooManyAttempts");
    expect(
      getAuthErrorKey(
        undefined,
        "login",
        new SignInRefusedError("account_rate_limited", 1).code.toUpperCase(),
      ),
    ).toBe("accountTooManyAttempts");
  });

  it("words each refusal of a second step by what the person can do about it", () => {
    // Better Auth's codes as its answer carries them, and the guard's own
    // (`src/lib/auth/policy-plugin.ts`): retype, start again with the
    // password, wait, or ask the operator.
    const words = (code: string) => getAuthErrorKey(undefined, "login", code);
    expect(words("INVALID_CODE")).toBe("twoFactorInvalidCode");
    // Its own sentence: "the one your app shows now" is wrong for paper.
    expect(words("INVALID_BACKUP_CODE")).toBe("backupCodeInvalid");
    expect(words("INVALID_TWO_FACTOR_COOKIE")).toBe("twoFactorExpired");
    expect(words("TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE")).toBe("twoFactorExpired");
    expect(words("ACCOUNT_TEMPORARILY_LOCKED")).toBe("twoFactorLocked");
    expect(words("TWO_FACTOR_UNREADABLE")).toBe("twoFactorUnreadable");
  });

  it("words a refused passkey by what the person can do about it", () => {
    // D151: Better Auth's codes, and the instance's own for an authenticator
    // that did not verify the person. Unknown or unverified cannot be fixed
    // by trying again; a lapsed challenge or a bad signature can.
    const words = (code: string) => getAuthErrorKey(undefined, "login", code);
    expect(words("PASSKEY_NOT_FOUND")).toBe("passkeyNotFound");
    expect(words("USER_VERIFICATION_REQUIRED")).toBe("passkeyNotVerified");
    expect(words("AUTHENTICATION_FAILED")).toBe("passkeyFailed");
    expect(words("CHALLENGE_NOT_FOUND")).toBe("passkeyFailed");
    expect(words("AUTH_CANCELLED")).toBe("passkeyFailed");
    // The step-up a passkey change needs (`src/lib/auth/step-up.ts`).
    expect(words("STEP_UP_REQUIRED")).toBe("stepUpRequired");
  });

  it("has words in both languages for every key it can answer", async () => {
    const catalogues = {
      es: (await import("../../../messages/es.json")).default.auth as Record<string, string>,
      en: (await import("../../../messages/en.json")).default.auth as Record<string, string>,
    };
    for (const key of [
      "twoFactorInvalidCode",
      "backupCodeInvalid",
      "twoFactorExpired",
      "twoFactorLocked",
      "twoFactorUnreadable",
      "passkeyFailed",
      "passkeyNotFound",
      "passkeyNotVerified",
      "stepUpRequired",
    ]) {
      expect(catalogues.es[key], `es ${key}`).toBeTruthy();
      expect(catalogues.en[key], `en ${key}`).toBeTruthy();
    }
  });

  it("falls back to the action-specific generic error", () => {
    expect(getAuthErrorKey(undefined, "login")).toBe("loginError");
    expect(getAuthErrorKey("unexpected failure", "register")).toBe(
      "registerError",
    );
  });
});
