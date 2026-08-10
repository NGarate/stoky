export type AuthAction = "login" | "register";

export type AuthErrorKey =
  | "emailExists"
  | "invalidCredentials"
  | "tooManyAttempts"
  | "authUnavailable"
  | "loginError"
  | "registerError";

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
  rate_limited: "tooManyAttempts",
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
