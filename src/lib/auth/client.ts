import type { SignInRefusal } from "@/lib/auth/sign-in-policy";
import type { DeadlineKind } from "@/lib/auth/session-policy";

/**
 * Every call the browser makes to authenticate, and nothing else.
 *
 * The login form, the registration form and the session keep-alive speak to
 * this module in a vocabulary that is ours, so replacing next-auth with Better
 * Auth (PROGRESS D135) rewrote this file and left them alone, and a component
 * test mocks one module of two functions completely (D50) instead of a
 * library.
 *
 * Plain `fetch`, not Better Auth's client: the auth API answers a handful of
 * endpoints (`src/server/http/auth-handler.ts`) and the three a sign-in needs
 * — the password, then an authenticator code or a backup code — are called
 * from here, which a client library would only wrap; so are the three that
 * change two-step verification from the settings screen, the four that
 * list, add, rename and remove passkeys, and the two a passkey sign-in is.
 * Browser-only by construction: no server import, nothing that reads a
 * secret. The one import from the server side is a type, erased at build, so
 * the server's refusal codes and the ones named here cannot drift apart.
 * `src/__tests__/unit/auth-dynamic.test.ts` keeps this the only browser code
 * that calls the auth API.
 */

/**
 * Why a sign-in was refused, in words the forms translate
 * (`getAuthErrorKey`, `src/lib/auth/error-messages.ts`):
 *
 * - `invalid_credentials` — the address or the password was wrong; deliberately
 *   not which.
 * - `rate_limited`, `account_rate_limited`, `auth_unavailable` — the server's
 *   own refusal codes (`SignInRefusedError`, `src/lib/auth/sign-in-policy.ts`).
 * - `unknown` — anything else; the form says the generic failure.
 */
export type SignInRefusalCode =
  "invalid_credentials" | SignInRefusal | "unknown";

/**
 * What a password step came to. `twoFactor` is neither a sign-in nor a
 * refusal: the password was right, the account has two-step verification
 * (D148), and the browser now holds a challenge that `verifyTotp` or
 * `verifyBackupCode` completes. Nobody is signed in until one of them says so.
 */
export type SignInResult =
  | { ok: true }
  | { ok: false; twoFactor: true }
  | {
      ok: false;
      twoFactor?: undefined;
      code: SignInRefusalCode;
      retryAfterSeconds?: number;
    };

/**
 * Why a second step was refused (D148, D149), in words the form translates:
 *
 * - `invalid_code` — the authenticator code was wrong, or already used;
 * - `invalid_backup_code` — the backup code was wrong, or already used;
 * - `two_factor_expired` — the challenge is gone (ten minutes, or five wrong
 *   codes): only the password step makes another, so the form goes back to it;
 * - `two_factor_locked` — Better Auth's lockout of the account, across
 *   challenges;
 * - `two_factor_unreadable` — the stored authenticator secret no longer
 *   decrypts (`STOKY_SECRET` changed): no code will ever work, a backup code
 *   still does;
 * - the route's own `rate_limited` and `auth_unavailable`, and `unknown`.
 */
export type SecondStepRefusalCode =
  | "invalid_code"
  | "invalid_backup_code"
  | "two_factor_expired"
  | "two_factor_locked"
  | "two_factor_codes_spent"
  | "two_factor_unreadable"
  | SignInRefusal
  | "unknown";

export type SecondStepResult =
  | { ok: true }
  | { ok: false; code: SecondStepRefusalCode; retryAfterSeconds?: number };

export interface PasswordCredentials {
  email: string;
  password: string;
  /**
   * The login form's "Mantener la sesión iniciada" box (D141). Required, so
   * every caller decides: a remembered session lasts ninety idle days rather
   * than fifteen minutes, and the server reads anything but `true` as no.
   */
  rememberMe: boolean;
}

/**
 * The auth API's codes, in ours. Only these are read: a code the forms have
 * no words for is `unknown`, never passed through as if it were one.
 *
 * - Better Auth's wrong address or password, and its refusal of a password too
 *   long to check, are both "wrong address or password": saying "too long"
 *   would tell a guesser something about the rule.
 * - The route's own refusals (`auth-handler.ts`) are the policy's codes in
 *   upper case.
 * - An origin Better Auth does not trust is the server's configuration, not
 *   the person's input: "unavailable" is the only true thing to tell them.
 */
const CODES: Record<string, SignInRefusalCode> = {
  INVALID_EMAIL_OR_PASSWORD: "invalid_credentials",
  PASSWORD_TOO_LONG: "invalid_credentials",
  INVALID_EMAIL: "invalid_credentials",
  INVALID_REQUEST: "invalid_credentials",
  RATE_LIMITED: "rate_limited",
  ACCOUNT_RATE_LIMITED: "account_rate_limited",
  AUTH_UNAVAILABLE: "auth_unavailable",
  INVALID_ORIGIN: "auth_unavailable",
  MISSING_OR_NULL_ORIGIN: "auth_unavailable",
};

/**
 * A second step's codes, in ours: Better Auth's, the TOTP guard's
 * (`src/lib/auth/policy-plugin.ts`) and the route's. Read the same way as
 * `CODES` — a code not listed is `unknown`.
 */
const SECOND_STEP_CODES: Record<string, SecondStepRefusalCode> = {
  INVALID_CODE: "invalid_code",
  INVALID_BACKUP_CODE: "invalid_backup_code",
  INVALID_TWO_FACTOR_COOKIE: "two_factor_expired",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "two_factor_expired",
  ACCOUNT_TEMPORARILY_LOCKED: "two_factor_locked",
  TOO_MANY_WRONG_CODES: "two_factor_codes_spent",
  TWO_FACTOR_UNREADABLE: "two_factor_unreadable",
  RATE_LIMITED: "rate_limited",
  AUTH_UNAVAILABLE: "auth_unavailable",
  INVALID_ORIGIN: "auth_unavailable",
  MISSING_OR_NULL_ORIGIN: "auth_unavailable",
};

/** A refusal's `code`, looked up in `codes`; anything else is `unknown`. */
function refusalOf<Code extends string>(
  body: unknown,
  retryAfter: string | null,
  codes: Record<string, Code>,
): { ok: false; code: Code | "unknown"; retryAfterSeconds?: number } {
  const raw =
    body && typeof body === "object" && "code" in body
      ? (body as { code: unknown }).code
      : null;
  const code = (typeof raw === "string" && codes[raw]) || "unknown";

  const seconds =
    retryAfter !== null && /^\d+$/.test(retryAfter.trim())
      ? Number(retryAfter)
      : null;
  return seconds !== null && seconds > 0
    ? { ok: false, code, retryAfterSeconds: seconds }
    : { ok: false, code };
}

/**
 * The sign-in endpoint's answer, in ours. Exported for its unit test;
 * components call `signInWithPassword`.
 *
 * A success that says `twoFactorRedirect` is not a sign-in: Better Auth has
 * set a challenge cookie and no session (D148), and reading it as `ok` would
 * send the person to a screen that sends them straight back here.
 *
 * `retryAfter` is the response's `Retry-After`, carried when it is a whole
 * number of seconds so a form can say how long to wait.
 */
export function signInResultFrom(
  status: number,
  body: unknown,
  retryAfter: string | null,
): SignInResult {
  if (status >= 200 && status < 300) {
    const asksForCode =
      body !== null &&
      typeof body === "object" &&
      (body as { twoFactorRedirect?: unknown }).twoFactorRedirect === true;
    return asksForCode ? { ok: false, twoFactor: true } : { ok: true };
  }
  return refusalOf(body, retryAfter, CODES);
}

/**
 * A second step's answer, in ours. Exported for its unit test; components
 * call `verifyTotp` and `verifyBackupCode`.
 */
export function secondStepResultFrom(
  status: number,
  body: unknown,
  retryAfter: string | null,
): SecondStepResult {
  if (status >= 200 && status < 300) return { ok: true };
  return refusalOf(body, retryAfter, SECOND_STEP_CODES);
}

/**
 * Signs in with an address and a password, and never navigates: the caller
 * decides where a signed-in person goes (`/`, where the screen choice is
 * honoured). Throws only when the request itself could not be made.
 */
export async function signInWithPassword(
  { email, password, rememberMe }: PasswordCredentials,
  fetcher: typeof fetch = fetch,
): Promise<SignInResult> {
  const response = await fetcher("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, rememberMe: rememberMe === true }),
    cache: "no-store",
    credentials: "same-origin",
  });
  const body: unknown = await response.json().catch(() => null);
  return signInResultFrom(
    response.status,
    body,
    response.headers.get("retry-after"),
  );
}

/**
 * Completes a two-step sign-in with the code the authenticator app shows now.
 * The challenge travels in its cookie, so the body is the code and nothing
 * else; the route forwards nothing else either. Never navigates; throws only
 * when the request itself could not be made.
 */
export async function verifyTotp(
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<SecondStepResult> {
  return secondStep("/api/auth/two-factor/verify-totp", code, fetcher);
}

/**
 * Completes a two-step sign-in with one of the backup codes (D149). Sent as
 * typed: the server reads lower case, spaces and dashes the same
 * (`normaliseBackupCode`), so the form need not.
 */
export async function verifyBackupCode(
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<SecondStepResult> {
  return secondStep("/api/auth/two-factor/verify-backup-code", code, fetcher);
}

async function secondStep(
  path: string,
  code: string,
  fetcher: typeof fetch,
): Promise<SecondStepResult> {
  const response = await fetcher(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
    cache: "no-store",
    credentials: "same-origin",
  });
  const body: unknown = await response.json().catch(() => null);
  return secondStepResultFrom(
    response.status,
    body,
    response.headers.get("retry-after"),
  );
}

/**
 * Why a change to two-step verification was refused (D148), in words the
 * settings screen translates:
 *
 * - `wrong_password` — the password re-entered to confirm it was wrong (or
 *   too long to be right, which says nothing more to a guesser);
 * - `too_many_attempts` — the route's re-entry budget is spent, with
 *   `retryAfterSeconds` when it said how long;
 * - `signed_out` — the session is gone;
 * - `already_enabled` / `not_enabled` — another tab or device changed it
 *   first, so the screen is out of date;
 * - `auth_unavailable`, and `unknown` for anything else.
 *
 * A change to the passkeys (D151) adds its own:
 *
 * - `step_up_required` — the password confirmed for it has lapsed or been
 *   spent (`auth.confirmPassword`, five minutes, one change);
 * - `cancelled` — the browser's prompt was dismissed, or timed out: the
 *   person said no, or never answered;
 * - `already_registered` — this authenticator already holds a passkey for
 *   the account;
 * - `not_verified` — the authenticator cannot check who is holding it
 *   (no fingerprint, face or PIN), which Stoky requires;
 * - `passkey_gone` — the passkey is not this account's, or no longer exists.
 */
export type AccountChangeRefusalCode =
  | "wrong_password"
  | "too_many_attempts"
  | "signed_out"
  | "already_enabled"
  | "not_enabled"
  | "step_up_required"
  | "cancelled"
  | "already_registered"
  | "not_verified"
  | "passkey_gone"
  | "auth_unavailable"
  | "unknown";

const ACCOUNT_CHANGE_CODES: Record<string, AccountChangeRefusalCode> = {
  INVALID_PASSWORD: "wrong_password",
  PASSWORD_TOO_LONG: "wrong_password",
  REAUTH_RATE_LIMITED: "too_many_attempts",
  UNAUTHORIZED: "signed_out",
  TOTP_ALREADY_ENABLED: "already_enabled",
  TWO_FACTOR_NOT_ENABLED: "not_enabled",
  AUTH_UNAVAILABLE: "auth_unavailable",
  INVALID_ORIGIN: "auth_unavailable",
  MISSING_OR_NULL_ORIGIN: "auth_unavailable",
};

/**
 * A refused change to two-step verification. Thrown rather than returned,
 * unlike a sign-in's refusals: every caller is a password dialog
 * (`ReauthDialog`) whose `onSubmit` rejects with the reason, which the dialog
 * words beside the field.
 */
export class AccountChangeRefusedError extends Error {
  constructor(
    readonly code: AccountChangeRefusalCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(`The change was refused: ${code}`);
    this.name = "AccountChangeRefusedError";
  }
}

/**
 * What turning on two-step verification hands back, once: the `otpauth:`
 * address the authenticator app reads (as a QR code, a link, or the key in
 * it typed by hand), and the backup codes in the clear. Neither can be asked
 * for again — the route never opens `get-totp-uri`, and the database holds
 * the codes only as hashes (D149) — so the screen shows them and forgets them.
 */
export interface TotpEnrolment {
  totpUri: string;
  backupCodes: string[];
}

/** POSTs `{ password }` to a change endpoint; the answer's body, or the refusal thrown. */
async function accountChange(
  path: string,
  password: string,
  fetcher: typeof fetch,
): Promise<unknown> {
  const response = await fetcher(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
    cache: "no-store",
    credentials: "same-origin",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const refusal = refusalOf(
      body,
      response.headers.get("retry-after"),
      ACCOUNT_CHANGE_CODES,
    );
    throw new AccountChangeRefusedError(
      refusal.code,
      refusal.retryAfterSeconds,
    );
  }
  return body;
}

/** The backup codes an answer carries, or a refusal: an answer without them is not one. */
function backupCodesOf(body: unknown): string[] {
  const codes = (body as { backupCodes?: unknown } | null)?.backupCodes;
  if (
    !Array.isArray(codes) ||
    codes.length === 0 ||
    !codes.every((code) => typeof code === "string")
  ) {
    throw new AccountChangeRefusedError("unknown");
  }
  return codes as string[];
}

/**
 * Starts turning on two-step verification: the password, then the new
 * authenticator's address and the backup codes. Nothing is on yet — it is on
 * when `verifyTotp` accepts the first code the new app shows, from this same
 * session. Throws `AccountChangeRefusedError` when refused.
 */
export async function startTotpEnrolment(
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<TotpEnrolment> {
  const body = await accountChange(
    "/api/auth/two-factor/enable",
    password,
    fetcher,
  );
  const totpUri = (body as { totpURI?: unknown } | null)?.totpURI;
  if (typeof totpUri !== "string" || !totpUri.startsWith("otpauth://totp/")) {
    throw new AccountChangeRefusedError("unknown");
  }
  return { totpUri, backupCodes: backupCodesOf(body) };
}

/** Turns two-step verification off, with the password. */
export async function turnOffTwoFactor(
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await accountChange("/api/auth/two-factor/disable", password, fetcher);
}

/** A new set of backup codes, with the password; the old set stops working. */
export async function replaceBackupCodes(
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  return backupCodesOf(
    await accountChange(
      "/api/auth/two-factor/generate-backup-codes",
      password,
      fetcher,
    ),
  );
}

/**
 * The passkey endpoints' codes, in ours: the policy plugin's
 * (`STEP_UP_REQUIRED`, `USER_VERIFICATION_REQUIRED`), Better Auth's, and the
 * route's. A registration that fails verification, or whose challenge has
 * gone, is `unknown`: the screen's words for it are "it did not work, try
 * again", which is all either means to the person.
 */
const PASSKEY_CODES: Record<string, AccountChangeRefusalCode> = {
  STEP_UP_REQUIRED: "step_up_required",
  USER_VERIFICATION_REQUIRED: "not_verified",
  PREVIOUSLY_REGISTERED: "already_registered",
  PASSKEY_NOT_FOUND: "passkey_gone",
  YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY: "passkey_gone",
  UNAUTHORIZED: "signed_out",
  AUTH_UNAVAILABLE: "auth_unavailable",
  INVALID_ORIGIN: "auth_unavailable",
  MISSING_OR_NULL_ORIGIN: "auth_unavailable",
};

/**
 * One of this account's passkeys, as the settings screen shows it — and
 * nothing more. The endpoint answers the whole row (public key, credential
 * id, counter); none of it means anything to a person, so none of it is
 * kept.
 *
 * `synced` is the authenticator's own backup flag: a passkey in a password
 * manager or a phone's keychain reaches the person's other devices; one in a
 * security key or a single device's chip does not.
 */
export interface PasskeySummary {
  id: string;
  name: string | null;
  createdAt: string;
  synced: boolean;
}

/** A request to a passkey endpoint; the answer's body, or the refusal thrown. */
async function passkeyRequest(
  path: string,
  init: { method: "GET" } | { method: "POST"; body: Record<string, unknown> },
  fetcher: typeof fetch,
): Promise<unknown> {
  const response = await fetcher(`/api/auth/passkey/${path}`, {
    method: init.method,
    ...(init.method === "POST"
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(init.body),
        }
      : {}),
    cache: "no-store",
    credentials: "same-origin",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const refusal = refusalOf(
      body,
      response.headers.get("retry-after"),
      PASSKEY_CODES,
    );
    throw new AccountChangeRefusedError(
      refusal.code,
      refusal.retryAfterSeconds,
    );
  }
  return body;
}

/** This account's passkeys, oldest first. Throws `AccountChangeRefusedError`. */
export async function listPasskeys(
  fetcher: typeof fetch = fetch,
): Promise<PasskeySummary[]> {
  const body = await passkeyRequest(
    "list-user-passkeys",
    { method: "GET" },
    fetcher,
  );
  if (!Array.isArray(body)) throw new AccountChangeRefusedError("unknown");
  return body
    .filter(
      (
        row,
      ): row is {
        id: string;
        name?: unknown;
        createdAt: string;
        backedUp?: unknown;
      } =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as { id?: unknown }).id === "string" &&
        typeof (row as { createdAt?: unknown }).createdAt === "string",
    )
    .map((row) => ({
      id: row.id,
      name:
        typeof row.name === "string" && row.name.trim() !== ""
          ? row.name
          : null,
      createdAt: row.createdAt,
      synced: row.backedUp === true,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Asks the browser to make a credential from the server's options, and
 * answers what it made. `@simplewebauthn/browser` is loaded here, on the
 * click, not with the page: nobody who never adds a passkey downloads it.
 */
export type CreateCredential = (optionsJSON: unknown) => Promise<unknown>;

const createWithBrowser: CreateCredential = async (optionsJSON) => {
  const { startRegistration } = await import("@simplewebauthn/browser");
  return startRegistration({
    optionsJSON: optionsJSON as Parameters<
      typeof startRegistration
    >[0]["optionsJSON"],
  });
};

/**
 * The browser's refusal to make a credential, in ours. `@simplewebauthn/browser`
 * wraps the DOM error in a `WebAuthnError` with a `code`, and passes a
 * `NotAllowedError` — which browsers raise for a dismissed prompt, a timeout
 * and a policy refusal alike — through as its `cause`.
 */
export function browserRefusalOf(error: unknown): AccountChangeRefusalCode {
  const code = (error as { code?: unknown } | null)?.code;
  const name =
    (error as { cause?: { name?: unknown } } | null)?.cause?.name ??
    (error as { name?: unknown } | null)?.name;
  if (
    code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" ||
    name === "InvalidStateError"
  ) {
    return "already_registered";
  }
  if (code === "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT")
    return "not_verified";
  if (
    code === "ERROR_CEREMONY_ABORTED" ||
    name === "NotAllowedError" ||
    name === "AbortError"
  ) {
    return "cancelled";
  }
  return "unknown";
}

/**
 * Adds a passkey on this device (D151), in the three steps a registration
 * is: the server's options (a challenge, and the account's existing
 * credentials so the same authenticator is not enrolled twice), the
 * browser's prompt, and the server's check of what it made.
 *
 * Needs a step-up first — `auth.confirmPassword`, the password re-entered —
 * which the options ask for and the check spends, whatever it decides: a
 * refusal here means asking for the password again. Throws
 * `AccountChangeRefusedError`.
 */
export async function addPasskey(
  name: string | null,
  {
    fetcher = fetch,
    create = createWithBrowser,
  }: { fetcher?: typeof fetch; create?: CreateCredential } = {},
): Promise<void> {
  const options = await passkeyRequest(
    "generate-register-options",
    { method: "GET" },
    fetcher,
  );
  let made: unknown;
  try {
    made = await create(options);
  } catch (error) {
    throw new AccountChangeRefusedError(browserRefusalOf(error));
  }
  // Without `clientExtensionResults`, as Better Auth's own client sends it:
  // the route forwards `response` and `name` and nothing else.
  const { clientExtensionResults: _extensions, ...response } = (made ??
    {}) as Record<string, unknown>;
  await passkeyRequest(
    "verify-registration",
    { method: "POST", body: name ? { response, name } : { response } },
    fetcher,
  );
}

/** Renames one of this account's passkeys. Needs the session only. */
export async function renamePasskey(
  id: string,
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await passkeyRequest(
    "update-passkey",
    { method: "POST", body: { id, name } },
    fetcher,
  );
}

/**
 * Removes one of this account's passkeys. Needs a step-up first, like adding
 * one, and spends it.
 */
export async function removePasskey(
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await passkeyRequest(
    "delete-passkey",
    { method: "POST", body: { id } },
    fetcher,
  );
}

/**
 * Why a passkey sign-in was refused (D151), in words the login form
 * translates (`getAuthErrorKey`):
 *
 * - `passkey_cancelled` — the browser's prompt was dismissed or timed out,
 *   or it found no passkey for this address to offer. Never reaches the
 *   server; the person said no, or had nothing to say yes with.
 * - `passkey_not_found` — the server does not know the passkey: removed, or
 *   made for another address. Trying again cannot help.
 * - `passkey_not_verified` — the authenticator did not check who was holding
 *   it (no fingerprint, face or PIN), which Stoky requires.
 * - `passkey_failed` — the challenge lapsed, the signature did not verify, or
 *   the browser failed in a way that is not a refusal: worth one more try.
 * - the route's own `rate_limited` and `auth_unavailable`, and `unknown`.
 */
export type PasskeySignInRefusalCode =
  | "passkey_cancelled"
  | "passkey_not_found"
  | "passkey_not_verified"
  | "passkey_failed"
  | SignInRefusal
  | "unknown";

export type PasskeySignInResult =
  | { ok: true }
  | { ok: false; code: PasskeySignInRefusalCode; retryAfterSeconds?: number };

/** A passkey sign-in's codes, in ours — Better Auth's, the policy plugin's and the route's. */
const PASSKEY_SIGN_IN_CODES: Record<string, PasskeySignInRefusalCode> = {
  PASSKEY_NOT_FOUND: "passkey_not_found",
  USER_VERIFICATION_REQUIRED: "passkey_not_verified",
  AUTHENTICATION_FAILED: "passkey_failed",
  CHALLENGE_NOT_FOUND: "passkey_failed",
  AUTH_CANCELLED: "passkey_failed",
  RATE_LIMITED: "rate_limited",
  AUTH_UNAVAILABLE: "auth_unavailable",
  INVALID_ORIGIN: "auth_unavailable",
  MISSING_OR_NULL_ORIGIN: "auth_unavailable",
};

/**
 * Asks the browser for a passkey answering the server's challenge. Loaded on
 * the click, like `CreateCredential`'s: nobody who signs in with a password
 * downloads it.
 */
export type GetCredential = (optionsJSON: unknown) => Promise<unknown>;

const getWithBrowser: GetCredential = async (optionsJSON) => {
  const { startAuthentication } = await import("@simplewebauthn/browser");
  return startAuthentication({
    optionsJSON: optionsJSON as Parameters<
      typeof startAuthentication
    >[0]["optionsJSON"],
  });
};

/**
 * Signs in with a passkey (D151), in the three steps an authentication is:
 * the server's challenge, the browser's prompt, and the server's check of the
 * answer. No address and no password: the passkey names the account. Never
 * navigates, and never asks for an authenticator code — the passkey is
 * already the second thing.
 *
 * `rememberMe` is the login form's box, read by the server as a literal
 * `true` or nothing, as the password's is (D141).
 *
 * A result rather than a throw, like `signInWithPassword`: the form words a
 * refusal in its status region. Throws only when a request itself could not
 * be made.
 */
export async function signInWithPasskey(
  { rememberMe }: { rememberMe: boolean },
  {
    fetcher = fetch,
    get = getWithBrowser,
  }: { fetcher?: typeof fetch; get?: GetCredential } = {},
): Promise<PasskeySignInResult> {
  const optionsResponse = await fetcher(
    "/api/auth/passkey/generate-authenticate-options",
    {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    },
  );
  const options: unknown = await optionsResponse.json().catch(() => null);
  if (!optionsResponse.ok) {
    return refusalOf(
      options,
      optionsResponse.headers.get("retry-after"),
      PASSKEY_SIGN_IN_CODES,
    );
  }

  let answer: unknown;
  try {
    answer = await get(options);
  } catch (error) {
    return {
      ok: false,
      code:
        browserRefusalOf(error) === "cancelled"
          ? "passkey_cancelled"
          : "passkey_failed",
    };
  }

  // Without `clientExtensionResults`, as for a registration: the route
  // forwards `response` and nothing else of it.
  const { clientExtensionResults: _extensions, ...response } = (answer ??
    {}) as Record<string, unknown>;
  const verified = await fetcher("/api/auth/passkey/verify-authentication", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ response, rememberMe: rememberMe === true }),
    cache: "no-store",
    credentials: "same-origin",
  });
  if (verified.ok) return { ok: true };
  const body: unknown = await verified.json().catch(() => null);
  return refusalOf(
    body,
    verified.headers.get("retry-after"),
    PASSKEY_SIGN_IN_CODES,
  );
}

/**
 * The session's expiry and which deadline it is (`deadlineKind`,
 * `src/lib/auth/session-policy.ts`).
 */
export interface SessionExpiry {
  expires: string;
  kind: DeadlineKind;
}

/**
 * Reads the session's current expiry, which also slides it: `auth.session`
 * moves a browser session's idle expiry forward when it is asked, and is asked
 * only on real activity (`SessionKeepAlive`). `null` when there is no session.
 *
 * A plain GET of the tRPC procedure rather than a query through the tRPC
 * client: an expiry is not data to keep in the query cache, or to persist for
 * offline use. Never cached — a stored answer would keep showing an expiry the
 * server has already moved.
 * Throws when the request fails; the keep-alive treats that as "nothing
 * changed" rather than as the session having ended.
 */
export async function readSessionExpiry(
  fetcher: typeof fetch = fetch,
): Promise<SessionExpiry | null> {
  const response = await fetcher("/api/trpc/auth.session", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`auth.session answered ${response.status}`);
  const body = (await response.json()) as {
    result?: { data?: { json?: { expires?: unknown; kind?: unknown } | null } };
  };
  const answer = body.result?.data?.json;
  if (typeof answer?.expires !== "string") return null;
  // Anything but an explicit "cap" is the idle deadline: the warning then
  // offers the button, and the worst a wrong guess costs is one press that
  // changes nothing. The other way round would hide a button that works.
  return {
    expires: answer.expires,
    kind: answer.kind === "cap" ? "cap" : "idle",
  };
}
