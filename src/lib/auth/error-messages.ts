export type AuthAction = "login" | "register";

export type AuthErrorKey =
  | "emailExists"
  | "invalidCredentials"
  | "loginError"
  | "registerError";

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
): AuthErrorKey {
  const normalizedMessage = message?.trim().toLowerCase() ?? "";

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
