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
 * Plain `fetch`, not Better Auth's client: the auth API answers five endpoints
 * (`src/server/http/auth-handler.ts`) and two of them are called from here,
 * which a client library would only wrap. Browser-only by construction: no
 * server import, nothing that reads a secret. The one import from the server
 * side is a type, erased at build, so the server's refusal codes and the ones
 * named here cannot drift apart. `src/__tests__/unit/auth-dynamic.test.ts`
 * keeps this the only browser code that calls the auth API.
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
export type SignInRefusalCode = "invalid_credentials" | SignInRefusal | "unknown";

export type SignInResult =
  | { ok: true }
  | { ok: false; code: SignInRefusalCode; retryAfterSeconds?: number };

export interface PasswordCredentials {
  email: string;
  password: string;
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
 * The sign-in endpoint's answer, in ours. Exported for its unit test;
 * components call `signInWithPassword`.
 *
 * `retryAfter` is the response's `Retry-After`, carried when it is a whole
 * number of seconds so a form can say how long to wait.
 */
export function signInResultFrom(
  status: number,
  body: unknown,
  retryAfter: string | null,
): SignInResult {
  if (status >= 200 && status < 300) return { ok: true };

  const raw =
    body && typeof body === "object" && "code" in body ? (body as { code: unknown }).code : null;
  const code = (typeof raw === "string" && CODES[raw]) || "unknown";

  const seconds = retryAfter !== null && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : null;
  return seconds !== null && seconds > 0
    ? { ok: false, code, retryAfterSeconds: seconds }
    : { ok: false, code };
}

/**
 * Signs in with an address and a password, and never navigates: the caller
 * decides where a signed-in person goes (`/`, where the screen choice is
 * honoured). Throws only when the request itself could not be made.
 */
export async function signInWithPassword(
  { email, password }: PasswordCredentials,
  fetcher: typeof fetch = fetch,
): Promise<SignInResult> {
  const response = await fetcher("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
    credentials: "same-origin",
  });
  const body: unknown = await response.json().catch(() => null);
  return signInResultFrom(response.status, body, response.headers.get("retry-after"));
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
  return { expires: answer.expires, kind: answer.kind === "cap" ? "cap" : "idle" };
}
