import { isRegistrationClosedRefusal } from "@/lib/auth/registration";
import { isPasswordIdentityRefusal } from "@/lib/validations/password";

export type AuthAction = "login" | "register";

export type AuthErrorKey =
  | "emailExists"
  | "invalidCredentials"
  | "tooManyAttempts"
  | "accountTooManyAttempts"
  | "authUnavailable"
  | "loginError"
  | "registerError"
  | "passwordContainsIdentity"
  | "registrationClosed"
  | "twoFactorInvalidCode"
  | "backupCodeInvalid"
  | "twoFactorExpired"
  | "twoFactorLocked"
  | "twoFactorUnreadable";

/**
 * Refusal codes, read before any message so a refusal is worded by what it
 * is. A rate-limited attempt is the case that matters: worded as a wrong
 * password it is the worst possible sentence, since the password was very
 * likely right.
 *
 * Two vocabularies reach here, both looked up in lower case: the sign-in
 * module's (`SignInRefusalCode`, `src/lib/auth/client.ts`), which the forms
 * pass, and the auth API's own upper-case codes — Better Auth's and the
 * route's (`src/server/http/auth-handler.ts`) — for any caller that hands one
 * over as it came.
 */
const CODE_KEYS: Record<string, AuthErrorKey> = {
  invalid_credentials: "invalidCredentials",
  rate_limited: "tooManyAttempts",
  // The account's counter, not the address's: a different network cannot
  // help, and the person may be the one someone else is locking out.
  account_rate_limited: "accountTooManyAttempts",
  auth_unavailable: "authUnavailable",
  // Better Auth's wrong address or password, and its refusal of a password
  // too long to check: both are "wrong", and saying "too long" would describe
  // the rule to a guesser.
  invalid_email_or_password: "invalidCredentials",
  password_too_long: "invalidCredentials",
  // An origin the instance does not trust is its configuration, not the
  // person's input; "unavailable" is the only true thing to tell them.
  invalid_origin: "authUnavailable",
  missing_or_null_origin: "authUnavailable",
  // The second step of a sign-in (D148). A replayed code is refused as
  // INVALID_CODE too, so the sentence says "or already used". A backup code
  // has its own sentence: "the one your app shows now" is the wrong advice
  // for a code written on paper.
  invalid_code: "twoFactorInvalidCode",
  invalid_backup_code: "backupCodeInvalid",
  // The challenge is gone — ten minutes passed, or five wrong codes ended it
  // — and only the password step makes another. `two_factor_expired` and
  // `two_factor_locked` are the sign-in module's names for these
  // (`SecondStepRefusalCode`, `src/lib/auth/client.ts`).
  invalid_two_factor_cookie: "twoFactorExpired",
  too_many_attempts_request_new_code: "twoFactorExpired",
  two_factor_expired: "twoFactorExpired",
  // Better Auth's lockout, per account, across challenges: fifteen minutes.
  account_temporarily_locked: "twoFactorLocked",
  two_factor_locked: "twoFactorLocked",
  // `STOKY_SECRET` changed and the stored secret no longer decrypts: no
  // authenticator code will ever work, but a backup code, stored as a hash,
  // still does (D149), so the sentence offers one before the operator.
  two_factor_unreadable: "twoFactorUnreadable",
};

const INVALID_CREDENTIALS_MARKERS = ["invalid credentials", "invalid email or password"];

const EMAIL_EXISTS_MARKERS = [
  "already registered",
  "already exists",
  "already in use",
  "unique constraint",
];

export function getAuthErrorKey(
  message: string | undefined,
  action: AuthAction,
  code?: string,
): AuthErrorKey {
  const fromCode = code ? CODE_KEYS[code.trim().toLowerCase()] : undefined;
  if (fromCode) return fromCode;

  // Before the lowercasing below: the marker is the schema's own message,
  // shared as a constant, and tRPC carries it verbatim inside the ZodError's
  // JSON. Checked before the generic fallback so a person refused for using
  // their own name is told that, not "check the details".
  if (isPasswordIdentityRefusal(message)) return "passwordContainsIdentity";

  // The operator has closed registration (`STOKY_REGISTRATION`). Matched on
  // the server's own constant for the same reason, and because the generic
  // "check the details" would send someone round the form again for a refusal
  // no detail of theirs can change.
  if (isRegistrationClosedRefusal(message)) return "registrationClosed";

  const normalizedMessage = message?.trim().toLowerCase() ?? "";

  if (normalizedMessage.includes("too many")) {
    // The registration path is tRPC rather than the auth API, so it carries
    // a message rather than a code.
    return "tooManyAttempts";
  }

  if (normalizedMessage.includes("temporarily unavailable")) {
    return "authUnavailable";
  }

  if (
    INVALID_CREDENTIALS_MARKERS.some((marker) =>
      normalizedMessage.includes(marker),
    )
  ) {
    return "invalidCredentials";
  }

  if (
    EMAIL_EXISTS_MARKERS.some((marker) =>
      normalizedMessage.includes(marker),
    )
  ) {
    return "emailExists";
  }

  return action === "login" ? "loginError" : "registerError";
}
