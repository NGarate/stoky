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
  | "registrationClosed";

/**
 * Auth.js flattens every sign-in failure to "CredentialsSignin" so a login
 * form cannot leak whether the address or the password was wrong. The one
 * thing it does pass through is a `CredentialsSignin` subclass's `code`, which
 * is why the rate-limit refusals are modelled as subclasses in `@/lib/auth`.
 *
 * Matched before the message markers below, because a rate-limited attempt
 * also arrives carrying "credentials" and would otherwise be reported as a
 * wrong password — which is the worst possible wording for it, since the
 * password was very likely right.
 */
const CODE_KEYS: Record<string, AuthErrorKey> = {
  // The sign-in module's name for a plain wrong address or password
  // (`SignInRefusalCode`, `src/lib/auth/client.ts`), which the forms now pass
  // here as a code rather than as next-auth's message.
  invalid_credentials: "invalidCredentials",
  rate_limited: "tooManyAttempts",
  // The account's counter, not the address's: a different network cannot
  // help, and the person may be the one someone else is locking out.
  account_rate_limited: "accountTooManyAttempts",
  auth_unavailable: "authUnavailable",
};

const INVALID_CREDENTIALS_MARKERS = [
  "credentialssignin",
  "invalid credentials",
  "credentials",
];

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
    // The registration path is tRPC rather than Auth.js, so it carries a
    // message rather than a code.
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
