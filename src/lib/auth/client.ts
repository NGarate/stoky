import { signIn } from "next-auth/react";
import type { SignInResponse } from "next-auth/react";
import type { SignInRefusal } from "@/lib/auth/sign-in-policy";

/**
 * Every call the browser makes to the auth library, and nothing else.
 *
 * The login form, the registration form and the session keep-alive each spoke
 * to next-auth directly — `signIn` from `next-auth/react` in two of them, a
 * hand-built fetch of `/api/auth/session` in the third — so replacing the
 * library meant three components learning a new result shape, and their tests
 * mocking a package they did not own. Now they speak to this module in a
 * vocabulary that is ours, the swap rewrites this file and leaves them alone,
 * and a component test mocks one module of two functions completely (D50)
 * instead of half of a third-party one.
 *
 * Browser-only by construction: no server import, nothing that reads a secret.
 * The one import from the server side is a type, erased at build, so the
 * server's refusal codes and the ones named here cannot drift apart.
 * `src/__tests__/unit/auth-dynamic.test.ts` keeps it the only importer of
 * `next-auth/react`.
 */

/**
 * Why a sign-in was refused, in words the forms translate
 * (`getAuthErrorKey`, `src/lib/auth/error-messages.ts`):
 *
 * - `invalid_credentials` — the address or the password was wrong; deliberately
 *   not which.
 * - `rate_limited`, `account_rate_limited`, `auth_unavailable` — the server's
 *   own refusal codes (`SignInRefusedError`, `src/lib/auth/sign-in-policy.ts`),
 *   passed through unchanged.
 * - `unknown` — anything else; the form says the generic failure.
 */
export type SignInRefusalCode = "invalid_credentials" | SignInRefusal | "unknown";

export type SignInResult =
  | { ok: true }
  | { ok: false; code: SignInRefusalCode; retryAfterSeconds?: number };

// A type, not an interface: next-auth's options are an index signature, which
// an interface does not satisfy.
export type PasswordCredentials = {
  email: string;
  password: string;
};

/**
 * The refusal codes the server sends that mean something other than a wrong
 * password. Only these pass through: the code arrives in a query string, and a
 * value the forms have no words for must not reach them as if it were one.
 */
const SERVER_REFUSAL_CODES = new Set<SignInRefusalCode>([
  "rate_limited",
  "account_rate_limited",
  "auth_unavailable",
]);

/**
 * next-auth's answer, in ours.
 *
 * A refused credentials sign-in still answers 200 with `ok: true`; the refusal
 * is in `error` (`CredentialsSignin`) and, for a `CredentialsSignin` subclass,
 * its `code` — `credentials` for a plain wrong password. `undefined` is what
 * `signIn` returns when it never reached the provider. next-auth carries no
 * `Retry-After`, so `retryAfterSeconds` is never set here.
 *
 * Exported for its unit test; components call `signInWithPassword`.
 */
export function signInResultFrom(response: SignInResponse | undefined): SignInResult {
  if (response && !response.error) return { ok: true };
  if (!response) return { ok: false, code: "unknown" };

  const code = response.code as SignInRefusalCode | undefined;
  if (code && SERVER_REFUSAL_CODES.has(code)) return { ok: false, code };
  if (response.error === "CredentialsSignin") return { ok: false, code: "invalid_credentials" };
  return { ok: false, code: "unknown" };
}

/** The slice of `next-auth/react`'s `signIn` this module calls. Injected by its test. */
type CredentialsSignIn = (
  provider: "credentials",
  options: PasswordCredentials & { redirect: false },
) => Promise<SignInResponse | undefined>;

/**
 * Signs in with an address and a password, and never navigates: the caller
 * decides where a signed-in person goes (`/`, where the screen choice is
 * honoured). Throws only when the request itself could not be made.
 */
export async function signInWithPassword(
  { email, password }: PasswordCredentials,
  // A wrapper rather than `signIn` itself: its overloads include a redirecting
  // one, and an arrow pins the call to the `redirect: false` signature.
  signInWith: CredentialsSignIn = (provider, options) => signIn(provider, options),
): Promise<SignInResult> {
  return signInResultFrom(
    await signInWith("credentials", { email, password, redirect: false }),
  );
}

/**
 * Reads the session's current expiry, which also slides it: next-auth
 * re-issues the token, with a fresh expiry, on every read (`src/lib/auth.ts`,
 * the `session` settings). `null` when there is no session.
 *
 * Never cached — a stored answer would keep showing an expiry the server has
 * already moved. Throws when the request fails; the keep-alive treats that as
 * "nothing changed" rather than as the session having ended.
 */
export async function readSessionExpiry(
  fetcher: typeof fetch = fetch,
): Promise<{ expires: string } | null> {
  const response = await fetcher("/api/auth/session", { cache: "no-store" });
  const session = (await response.json()) as { expires?: unknown } | null;
  return typeof session?.expires === "string" ? { expires: session.expires } : null;
}
