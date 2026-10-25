import {
  RateLimitUnavailableError,
  clientAddress,
  passkeyOptionsRateLimit,
  reauthAccountRateLimit,
  reauthRateLimit,
} from "@/lib/rate-limit";
import { logSecurityEvent } from "@/lib/security-log";
import {
  SignInRefusedError,
  chargeSignInAddress,
  chargeSignInAttempt,
  secondFactorSucceeded,
  signInChallenged,
  signInFailed,
  signInSucceeded,
  valkeySignInLimiter,
  type AddressCharge,
  type SignInLimiter,
} from "@/lib/auth/sign-in-policy";
import type { PresentedSession, SignInTidy } from "@/lib/auth/sign-in-tidy";
import { deviceIdFromHeaders } from "@/lib/auth/known-devices";
import { REMEMBER_HEADER } from "@/lib/auth/session-policy";
import { passkeyNameSchema } from "@/lib/validations/auth";
import { describeErrorLine } from "@/server/log-error";
import { MAX_AUTH_BODY_BYTES, readBodyWithin } from "./body-limit";
import { refuseCrossSite, refuseNonJson } from "./request-guards";

/**
 * The auth API (`/api/auth/*`), with this application's policy around Better
 * Auth's handler — built from its parts, like `trpc-handler.ts`, so a unit test
 * can drive it with a plain `Request` and a fake handler: no Next server, no
 * Postgres, no Valkey (PROGRESS D135).
 *
 * `src/app/api/auth/[...all]/route.ts` only injects Better Auth into this.
 * Everything decided about a request is decided here, in this order, and the
 * order is the policy:
 *
 * 1. **An allowlist of method and path.** Better Auth mounts dozens of
 *    endpoints — sign-up, password reset, account deletion, session listing —
 *    and this application uses seventeen. Anything else is 404 before Better Auth
 *    sees it, so an endpoint a future version adds is closed until somebody
 *    decides otherwise. `disabledPaths` is not used: it is a denylist.
 * 2. **The body, bounded** (`readBodyWithin`, 64 KiB), before anything is
 *    parsed.
 * 3. **Fetch Metadata** on every request (`refuseCrossSite`): a GET from
 *    another site is refused too, before anything is charged, or a page
 *    elsewhere could spend the passkey options' per-address budget.
 * 4. **JSON only** on a POST (`refuseNonJson`): Better Auth also takes a form
 *    post on sign-in, which a page on another origin can send without a
 *    preflight.
 * 5. **Only the body keys each endpoint needs**, rebuilt rather than passed:
 *    a sign-in carries an address, a password and `rememberMe`, and nothing —
 *    no `callbackURL` — that Better Auth would act on; a second step carries
 *    its `code` and nothing else, so no `trustDevice` (a cookie that skips the
 *    code for a month) and no `disableSession` (a backup code spent without
 *    a session to show for it); a change to two-step verification carries
 *    the password and nothing else, so no `issuer` and no `method`; a passkey
 *    registration carries no `createSession`, and a passkey sign-in its
 *    WebAuthn answer alone. `x-stoky-remember` is
 *    this route's to set, so a copy a client sent is deleted from every
 *    request forwarded.
 * 6. **Our limits** (`src/lib/auth/sign-in-policy.ts`), charged before the
 *    JSON is believed, so a body that does not parse is still an attempt.
 * 7. **Better Auth.**
 * 8. **The response, guarded:** the session token is the cookie's value, and
 *    no script on the page needs it in a body or a header. A native client,
 *    which sends no cookie, gets it in `set-auth-token` (D142).
 *
 * **Remember-me** (D141): the box is `rememberMe`, true only when the body
 * says exactly `true` — Better Auth reads a missing value as true, and an
 * unticked box must not become a ninety-day cookie. The route says which it
 * was in `x-stoky-remember`, which the create hook records on the row. A ticked
 * sign-in also clears the `dont_remember` cookie an earlier unticked one left:
 * Better Auth clears that cookie only at a sign-out (a read that finds the
 * session gone no longer does, `src/lib/auth/policy-plugin.ts`), never at a
 * ticked sign-in, and while the browser holds it Better Auth treats every
 * session there as not remembered.
 *
 * A sign-in that gets in is followed by its tidy (`sessions.tidy`): the
 * session the browser presented ends, the account's expired rows go (D139),
 * and the account is held to ten sessions (D140) — `src/lib/auth/sign-in-tidy.ts`.
 *
 * **Two-step verification** (D148). A right password on an account that has
 * it is not a sign-in: Better Auth answers `twoFactorRedirect` with a
 * challenge cookie instead of a session. The password's charge is settled
 * then, the session the browser presented ends then, and the line says
 * `challenged`. The code that follows is a request of its own
 * (`secondStep`), charged per address — it names no account — and a sign-in
 * only when it carried the challenge and was answered with a session. The
 * same endpoint with a signed-in session is the enrolment check, charged
 * against the re-entry budgets instead.
 *
 * **Changing two-step verification** (D148): turning it on, turning it off
 * and replacing the backup codes are answered only for a signed-in session,
 * with the password (`accountChange`), charged against the same two budgets
 * as every other re-entered password (D143) before Better Auth checks it.
 * Every role may do it, the kitchen's shared account included (the owner's
 * decision of 2026-10-15).
 *
 * **Passkeys** (D151), where they can work (`src/lib/auth/passkeys.ts`): a
 * sign-in (`passkeySignIn`) is a sign-in like the password's — charged per
 * address, the box honoured, tidied, recorded with `method: "passkey"` —
 * except that it names no account until Better Auth has looked the passkey
 * up. Adding and removing one is answered for a signed-in session that has
 * just re-entered its password (the step-up, `src/lib/auth/step-up.ts`,
 * which the policy plugin checks), and recorded. Every role may, the
 * kitchen's shared account included.
 *
 * Every answer is `no-store`: a refusal served from a cache would refuse
 * somebody else.
 */

/** Better Auth's request handler, as `toNextJsHandler` returns it. */
export type AuthEndpointHandler = (req: Request) => Promise<Response>;

export interface AuthHandlerOptions {
  /**
   * Better Auth's handler, asked for per request so that building the
   * instance — which can refuse the environment — happens inside the request
   * that needs it and is answered as a 503 rather than a crash.
   */
  handler: () => AuthEndpointHandler;
  /** The counters; Valkey unless a test passes its own. */
  limiter?: SignInLimiter;
  /**
   * The session rows around a sign-in. The route always passes them
   * (`src/app/api/auth/[...all]/route.ts`); a unit test that leaves them out
   * gets a sign-in with no tidy, since both need the database.
   */
  sessions?: SignInSessions;
  /**
   * Better Auth's `dont_remember` cookie, as the instance names it: the name
   * carries the `__Secure-` prefix when the canonical address is https, so it
   * is asked of the instance rather than written here. The route always
   * passes it; without it a ticked sign-in leaves the cookie alone.
   */
  dontRememberCookie?: () => Promise<{ name: string; secure: boolean }>;
  /**
   * The names of Better Auth's challenge cookie (`two_factor`) and session
   * cookie, as the instance names them (prefixed on https): what tells a
   * second step that signed somebody in from one that did not. Without it,
   * no second step is recorded as a sign-in.
   */
  twoFactorCookies?: () => Promise<{ challenge: string; session: string }>;
}

export interface SignInSessions {
  /**
   * The valid session a request carries, or null — read before Better Auth
   * answers the sign-in, so it is the session being replaced.
   */
  presented: (headers: Headers) => Promise<PresentedSession | null>;
  /** Ends what a sign-in replaces, and what is past the cap (`tidyAfterSignIn`). */
  tidy: (input: SignInTidy) => Promise<unknown>;
  /**
   * Ends the presented session of a password step that stopped for a code
   * (`endPresentedSession`); `account` is the tag of the account asking.
   */
  end: (previous: PresentedSession, account: string) => Promise<unknown>;
}

export const AUTH_BASE_PATH = "/api/auth";

/**
 * Every endpoint the auth API answers, as "METHOD /path" under
 * `AUTH_BASE_PATH`. Adding one is a decision about what an unauthenticated
 * caller may reach.
 */
export const ALLOWED_AUTH_ENDPOINTS: ReadonlySet<string> = new Set([
  "POST /sign-in/email",
  // The second step of a sign-in (D148); the same `verify-totp` is also the
  // first code from a new authenticator, which turns it on.
  "POST /two-factor/verify-totp",
  "POST /two-factor/verify-backup-code",
  // Setting it up from `/settings/security`, each with the password
  // (`accountChange`). Never `/two-factor/get-totp-uri`: it hands the
  // decrypted secret back to anyone holding the session, password or not.
  "POST /two-factor/enable",
  "POST /two-factor/disable",
  "POST /two-factor/generate-backup-codes",
  // Passkeys (D151), registered only where they can work; elsewhere these
  // reach no endpoint and answer 404 all the same. Adding and removing one
  // need the step-up the policy plugin checks; renaming and listing, the
  // session alone.
  "GET /passkey/generate-authenticate-options",
  "POST /passkey/verify-authentication",
  "GET /passkey/generate-register-options",
  "POST /passkey/verify-registration",
  "POST /passkey/delete-passkey",
  "POST /passkey/update-passkey",
  "GET /passkey/list-user-passkeys",
  "POST /sign-out",
  "GET /get-session",
  "GET /ok",
  "GET /error",
]);

/**
 * The passkey endpoints a signed-in person changes their own passkeys
 * through: the body keys each may carry, and what the log calls a success.
 */
const PASSKEY_CHANGES: Record<
  string,
  {
    keys: readonly string[];
    event: "auth.passkey.added" | "auth.passkey.removed" | null;
  }
> = {
  "POST /passkey/verify-registration": {
    keys: ["response", "name"],
    event: "auth.passkey.added",
  },
  "POST /passkey/delete-passkey": {
    keys: ["id"],
    event: "auth.passkey.removed",
  },
  "POST /passkey/update-passkey": { keys: ["id", "name"], event: null },
};

/**
 * The query each forwarded GET may carry; everything else is dropped. The
 * registration options take the kind of authenticator wanted, and nothing
 * else: no `name` to label somebody's credential, no `context` for a flow
 * this application does not have.
 */
const KEPT_QUERY: Record<string, readonly string[]> = {
  "GET /passkey/generate-register-options": ["authenticatorAttachment"],
};

/**
 * The changes to two-step verification, each confirmed with the password, as
 * `accountChange` records them.
 */
const ACCOUNT_CHANGES: Record<string, "enable" | "disable" | "replace-codes"> =
  {
    "POST /two-factor/enable": "enable",
    "POST /two-factor/disable": "disable",
    "POST /two-factor/generate-backup-codes": "replace-codes",
  };

/** The factor each second-step endpoint proves, as the log names it. */
const SECOND_STEPS: Record<string, "totp" | "backup-code"> = {
  "POST /two-factor/verify-totp": "totp",
  "POST /two-factor/verify-backup-code": "backup-code",
};

export async function handleAuthRequest(
  incoming: Request,
  options: AuthHandlerOptions,
): Promise<Response> {
  const response = await answer(incoming, options);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function answer(
  incoming: Request,
  options: AuthHandlerOptions,
): Promise<Response> {
  const url = new URL(incoming.url);
  const endpoint = `${incoming.method} ${
    url.pathname.startsWith(`${AUTH_BASE_PATH}/`)
      ? url.pathname.slice(AUTH_BASE_PATH.length)
      : url.pathname
  }`;
  if (!ALLOWED_AUTH_ENDPOINTS.has(endpoint)) return notFound();

  let body: Uint8Array<ArrayBuffer> | null = null;
  if (incoming.method === "POST") {
    const read = await readBodyWithin(incoming, MAX_AUTH_BODY_BYTES);
    if (!read.ok) return read.response;
    body = read.body;

    const refused =
      refuseCrossSite(incoming, AUTH_BASE_PATH) ?? refuseNonJson(incoming);
    if (refused) return refused;
  } else {
    // A GET too: the passkey options spend a per-address budget, and an
    // <img> on any page a household member visits would otherwise spend it
    // from the household's own address.
    const refused = refuseCrossSite(incoming, AUTH_BASE_PATH);
    if (refused) return refused;
  }

  let handle: AuthEndpointHandler;
  try {
    handle = options.handler();
  } catch (error) {
    // The instance refused this environment (`assertAuthEnvironment`). Said
    // in prose for the operator and as an event for the log's readers; the
    // caller learns only that sign-in is unavailable.
    logSecurityEvent("auth.unavailable", {
      address: clientAddress(incoming.headers),
    });
    console.error(error instanceof Error ? error.message : error);
    return codeResponse(
      503,
      "AUTH_UNAVAILABLE",
      "Sign-in is temporarily unavailable",
    );
  }

  if (endpoint === "POST /sign-in/email") {
    return signIn(incoming, body, handle, options);
  }
  const secondStepMethod = SECOND_STEPS[endpoint];
  if (secondStepMethod) {
    return secondStep(
      incoming,
      body,
      handle,
      options,
      secondStepMethod,
      `${AUTH_BASE_PATH}${endpoint.slice(5)}`,
    );
  }
  const change = ACCOUNT_CHANGES[endpoint];
  if (change) {
    return accountChange(
      incoming,
      body,
      handle,
      options,
      change,
      `${AUTH_BASE_PATH}${endpoint.slice(5)}`,
    );
  }
  if (endpoint === "POST /passkey/verify-authentication") {
    return passkeySignIn(incoming, body, handle, options);
  }
  if (endpoint === "GET /passkey/generate-authenticate-options") {
    return passkeyOptions(incoming, handle, options);
  }
  const passkeyChange = PASSKEY_CHANGES[endpoint];
  if (passkeyChange) {
    return changePasskey(incoming, body, handle, options, passkeyChange);
  }
  if (endpoint === "POST /sign-out") {
    // It takes nothing this application uses.
    return guardResponse(incoming, await handle(rebuild(incoming, "{}")));
  }
  return guardResponse(
    incoming,
    await handle(
      withoutInternalHeaders(incoming, KEPT_QUERY[endpoint] ?? null),
    ),
  );
}

/**
 * A password sign-in: charged, rebuilt, forwarded and settled.
 *
 * The charge is made on the address the body names, before the body is
 * believed — a body that is not JSON is charged with no address, which counts
 * it against the client's address alone (`chargeSignInAttempt`'s
 * "malformed"). Only then is the password looked at, by Better Auth, and its
 * answer settles the charge: a success refunds it and records the sign-in, a
 * refusal of the caller's input is a failed attempt.
 *
 * The session the request presented is read before Better Auth answers, and
 * ended after it lets the caller in, with the account's expired rows
 * (`tidyAfterSignIn`). Not before: a wrong password ends nothing, or anybody
 * could sign a shared tablet out by typing at it.
 *
 * A ticked box clears `dont_remember` twice over: from the request Better
 * Auth reads, and, once the password is accepted, from the browser. Not on a
 * refusal, which changes nothing about the browser.
 */
async function signIn(
  incoming: Request,
  body: Uint8Array<ArrayBuffer> | null,
  handle: AuthEndpointHandler,
  options: AuthHandlerOptions,
): Promise<Response> {
  const limiter = options.limiter ?? valkeySignInLimiter;
  const sessions = options.sessions;
  const parsed = parseJsonObject(body);

  let attempt;
  try {
    attempt = await chargeSignInAttempt(
      incoming.headers,
      parsed?.email,
      limiter,
    );
  } catch (error) {
    if (error instanceof SignInRefusedError) return refusedSignIn(error);
    throw error;
  }
  if (attempt.outcome === "malformed") return invalidRequest();

  const password = parsed?.password;
  if (typeof password !== "string") {
    signInFailed(attempt);
    return invalidRequest();
  }

  const previous = sessions ? await sessions.presented(incoming.headers) : null;
  const remember = await rememberChoice(parsed, options);

  const response = await handle(
    rebuild(
      incoming,
      JSON.stringify({
        email: attempt.email,
        password,
        rememberMe: remember.rememberMe,
      }),
      remember.adjust,
    ),
  );

  if (response.ok) {
    const issued = await issuedSession(response);
    if (issued) {
      await signInSucceeded(attempt, issued.userId, "password", limiter);
      if (issued.token && sessions) {
        await tidyQuietly(sessions, {
          previous,
          userId: issued.userId,
          newToken: issued.token,
        });
      }
    } else if (await asksForSecondStep(response)) {
      await signInChallenged(attempt, limiter);
      if (previous && sessions) {
        await quietly("ending the presented session", () =>
          sessions.end(previous, attempt.accountTag),
        );
      }
    }
  } else if (response.status >= 400 && response.status < 500) {
    signInFailed(attempt);
  }

  return remember.finish(await guardResponse(incoming, response), response.ok);
}

/**
 * The login form's box, read the one way every sign-in reads it (D141).
 *
 * - **`rememberMe` is true only when the body says exactly `true`**: Better
 *   Auth reads a missing value as true, and an unticked box must not become a
 *   ninety-day cookie.
 * - **`adjust`** says which it was in `x-stoky-remember`, for the create
 *   hook, and for a ticked box takes `dont_remember` out of the request
 *   Better Auth reads — while it is there Better Auth treats every session as
 *   not remembered.
 * - **`finish`** clears `dont_remember` from the browser too, once the
 *   sign-in got in. Not on a refusal, which changes nothing about the
 *   browser. Better Auth clears that cookie only at a sign-out, never at a
 *   ticked sign-in.
 */
async function rememberChoice(
  parsed: Record<string, unknown> | null,
  options: AuthHandlerOptions,
): Promise<{
  rememberMe: boolean;
  adjust: (headers: Headers) => void;
  finish: (answer: Response, ok: boolean) => Response;
}> {
  const rememberMe = parsed?.rememberMe === true;
  const dontRemember =
    rememberMe && options.dontRememberCookie
      ? await options.dontRememberCookie()
      : null;
  return {
    rememberMe,
    adjust: (headers) => {
      headers.set(REMEMBER_HEADER, rememberMe ? "1" : "0");
      if (dontRemember) {
        const cookie = withoutCookie(headers.get("cookie"), dontRemember.name);
        if (cookie) headers.set("cookie", cookie);
        else headers.delete("cookie");
      }
    },
    finish: (answer, ok) => {
      if (dontRemember && ok) {
        answer.headers.append(
          "set-cookie",
          `${dontRemember.name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${
            dontRemember.secure ? "; Secure" : ""
          }`,
        );
      }
      return answer;
    },
  };
}

/**
 * A `Cookie` header without the cookie called `name`, every other pair left
 * exactly as it came — including ones that do not parse, which are not this
 * function's to judge. Null when nothing is left.
 */
function withoutCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const kept = header
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair && pair.split("=", 1)[0].trim() !== name);
  return kept.length ? kept.join("; ") : null;
}

/**
 * A GET as it came, less the headers only this route may set: a GET is
 * forwarded rather than rebuilt, and a client's own `x-stoky-remember` must
 * not reach Better Auth's hooks on any path. With `keptQuery`, the query
 * keeps those parameters alone; without it, the query is passed as it came.
 *
 * Made from the URL, not as `new Request(incoming, { headers })`: Bun 1.4.3
 * keeps the original headers when the replacement is empty, so a request
 * whose only header was this one would keep it.
 */
function withoutInternalHeaders(
  incoming: Request,
  keptQuery: readonly string[] | null = null,
): Request {
  const url = new URL(incoming.url);
  if (keptQuery) {
    // Collected first: deleting while iterating the params skips the next one.
    const dropped = Array.from(url.searchParams.keys()).filter(
      (key) => !keptQuery.includes(key),
    );
    for (const key of dropped) url.searchParams.delete(key);
  }
  if (!incoming.headers.has(REMEMBER_HEADER) && url.href === incoming.url)
    return incoming;
  const headers = new Headers(incoming.headers);
  headers.delete(REMEMBER_HEADER);
  return new Request(url, {
    method: incoming.method,
    headers,
    signal: incoming.signal,
  });
}

/** The JSON object a body holds, or null for anything else. */
function parseJsonObject(
  body: Uint8Array<ArrayBuffer> | null,
): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Who a successful answer signed in, and the raw token of the session it
 * issued — read here, before `guardResponse` strips the token from the body.
 * The token is `token` in a sign-in's answer and `session.token` in one that
 * carries the session; a 200 without one issued no session.
 */
async function issuedSession(response: Response): Promise<{
  userId: string;
  email: string | undefined;
  token: string | null;
} | null> {
  try {
    const body = (await response.clone().json()) as {
      user?: { id?: unknown; email?: unknown };
      token?: unknown;
      session?: { token?: unknown };
    } | null;
    if (typeof body?.user?.id !== "string") return null;
    const token =
      typeof body.token === "string" ? body.token : body.session?.token;
    return {
      userId: body.user.id,
      email: typeof body.user.email === "string" ? body.user.email : undefined,
      token: typeof token === "string" && token ? token : null,
    };
  } catch {
    return null;
  }
}

/**
 * The tidy, without letting it fail a sign-in that has already succeeded: the
 * new session exists and its cookie is in this answer, and throwing here would
 * withhold the cookie and leave its row behind. The session it could not end
 * still ends on its own clock — fifteen idle minutes, a day at most — and the
 * failure is on the log.
 */
async function tidyQuietly(
  sessions: SignInSessions,
  input: SignInTidy,
): Promise<void> {
  await quietly("the sign-in tidy", () => sessions.tidy(input));
}

/**
 * Runs `work` after an answer has been decided, logging rather than throwing
 * if it fails: what it would have ended still ends on its own clock.
 *
 * The failure is a Prisma one more often than not, so it is written through
 * `describeErrorLine`: a validation error's message carries the call's
 * arguments, and the tidy's include the new session's token
 * (`NOT: { token: newToken }` in `src/lib/auth/sign-in-tidy.ts`).
 */
async function quietly(
  what: string,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(
      `[auth] error ${what} failed: ${describeErrorLine(error).slice(0, 300)}`,
    );
  }
}

/** Whether Better Auth answered a right password with "now the code" (D148). */
async function asksForSecondStep(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as {
      twoFactorRedirect?: unknown;
    } | null;
    return body?.twoFactorRedirect === true;
  } catch {
    return false;
  }
}

/**
 * A second step: an authenticator code or a backup code, after a password
 * step that asked for one (D148).
 *
 * - **A sign-in's code is charged per address only**, before the body is
 *   believed: the request names no account — only the challenge cookie
 *   does, and only Better Auth reads it — and Better Auth counts wrong codes
 *   itself, five per challenge and ten per account.
 * - **A signed-in session's code is not a sign-in**, and is not charged to
 *   sign-in's address budget: it is the enrolment check, which Better Auth
 *   answers from the session before any challenge, and nothing gives a
 *   success there back to that budget, so every authenticator set up behind
 *   one address would spend a sign-in attempt for everybody there for a
 *   quarter of an hour. It is charged against the session's and the
 *   account's re-entry budgets instead (`chargeReentry`, D143), as the
 *   password that started the enrolment was, and a right code gives the
 *   session's attempt back.
 * - **`code` and nothing else** reaches Better Auth.
 * - **A sign-in only when** the request carried the challenge cookie, did not
 *   already hold a session, and was answered with a session cookie. Then:
 *   the address refunded, this browser remembered, the account tidied
 *   (expired rows, the ten-session cap; the presented session was ended at
 *   the password step), and `auth.signin.succeeded` with the factor.
 * - **The same endpoint with a session and no challenge** is Better Auth's
 *   enrolment check: the first code from a new authenticator. When it
 *   re-creates the session, two-step verification has just been turned on,
 *   and the line says so.
 * - **A refusal** is `auth.twofactor.failed` with Better Auth's code, or
 *   `locked` — Better Auth's fifteen-minute lock, or the account's day of
 *   wrong codes spent (`TOO_MANY_WRONG_CODES`, the policy plugin's). An
 *   unreadable secret or a replayed code was already written by
 *   the guard that refused it (`src/lib/auth/policy-plugin.ts`); a replay is
 *   also a failed code, and is written as one too.
 */
async function secondStep(
  incoming: Request,
  body: Uint8Array<ArrayBuffer> | null,
  handle: AuthEndpointHandler,
  options: AuthHandlerOptions,
  method: "totp" | "backup-code",
  path: string,
): Promise<Response> {
  const limiter = options.limiter ?? valkeySignInLimiter;
  const sessions = options.sessions;

  // Read first, because it decides the budget: Better Auth checks a code
  // against the session a request carries before any challenge.
  const previous = sessions ? await sessions.presented(incoming.headers) : null;
  const address = clientAddress(incoming.headers);

  let charge: AddressCharge | null = null;
  let sessionWindow: number | null = null;
  if (previous) {
    const reentry = await chargeReentry(limiter, previous, address, path);
    if (reentry instanceof Response) return reentry;
    sessionWindow = reentry.sessionWindow;
  } else {
    try {
      charge = await chargeSignInAddress(incoming.headers, limiter);
    } catch (error) {
      if (error instanceof SignInRefusedError) return refusedSignIn(error);
      throw error;
    }
  }

  const code = parseJsonObject(body)?.code;
  if (typeof code !== "string") {
    logSecurityEvent("auth.twofactor.failed", { address, code: "malformed" });
    return invalidRequest();
  }

  const names = options.twoFactorCookies
    ? await options.twoFactorCookies()
    : null;
  const carriedChallenge = names
    ? hasCookie(incoming.headers.get("cookie"), names.challenge)
    : false;

  const response = await handle(rebuild(incoming, JSON.stringify({ code })));

  if (response.ok && previous && sessionWindow !== null) {
    await limiter.refund(reauthRateLimit(), previous.id, sessionWindow);
  }

  if (response.ok) {
    const setsSession = names ? setsCookie(response, names.session) : false;
    const issued = setsSession ? await issuedSession(response) : null;
    if (issued && carriedChallenge && !previous && charge) {
      await secondFactorSucceeded(
        charge,
        {
          userId: issued.userId,
          email: issued.email,
          deviceId: deviceIdFromHeaders(incoming.headers),
        },
        method,
        limiter,
      );
      if (issued.token && sessions) {
        await tidyQuietly(sessions, {
          previous: null,
          userId: issued.userId,
          newToken: issued.token,
        });
      }
    } else if (issued && previous && method === "totp") {
      logSecurityEvent("auth.twofactor.enabled", {
        userId: previous.userId,
        address,
      });
    }
  } else {
    const refusal = await refusalCode(response);
    if (
      refusal === "ACCOUNT_TEMPORARILY_LOCKED" ||
      refusal === "TOO_MANY_WRONG_CODES"
    ) {
      logSecurityEvent("auth.twofactor.locked", { address, code: refusal });
    } else if (
      refusal !== "TWO_FACTOR_UNREADABLE" &&
      response.status >= 400 &&
      response.status < 500
    ) {
      logSecurityEvent("auth.twofactor.failed", {
        address,
        code: refusal ?? undefined,
      });
    }
  }

  return guardResponse(incoming, response);
}

/**
 * A change to two-step verification: turning it on, turning it off, or a new
 * set of backup codes (D148, D149). Better Auth asks for the password on all
 * three; this is what happens around that.
 *
 * - **A signed-in session, or nothing.** Read before anything is charged: the
 *   budgets are the session's and its account's, and with no session Better
 *   Auth would refuse before looking at the password anyway.
 * - **Both re-entry budgets, before the password is believed** (D143): per
 *   session (`reauthRateLimit`), so a stolen session cannot spend the owner's
 *   attempts, and per account (`reauthAccountRateLimit`), so ten sessions are
 *   not ten budgets. Fails closed, like every limit on a password.
 * - **The password and nothing else** reaches Better Auth: no `issuer` to
 *   rename the entry in somebody's app, no `method` to pick a kind of code
 *   this instance does not send.
 * - **A right password gives the session's attempt back**, to the window that
 *   counted it, as `confirmCurrentPassword` does; the account's stays counted.
 * - **The log:** a wrong password is `auth.reauth.refused`, `via:
 *   "two-factor"`; turning it off is `auth.twofactor.disabled`; new codes are
 *   `auth.twofactor.codes-regenerated`. Turning it on is not written here:
 *   it is on only once the first code is accepted, and `secondStep` writes
 *   `auth.twofactor.enabled` then.
 *
 * No role is refused: every account may protect itself with a second factor,
 * the kitchen's shared one included (the owner's decision of 2026-10-15). A
 * shared account that loses its authenticator has its backup codes, or an
 * admin.
 */
async function accountChange(
  incoming: Request,
  body: Uint8Array<ArrayBuffer> | null,
  handle: AuthEndpointHandler,
  options: AuthHandlerOptions,
  change: "enable" | "disable" | "replace-codes",
  path: string,
): Promise<Response> {
  const limiter = options.limiter ?? valkeySignInLimiter;
  const presented = options.sessions
    ? await options.sessions.presented(incoming.headers)
    : null;
  if (!presented) return codeResponse(401, "UNAUTHORIZED", "Sign in first");
  const address = clientAddress(incoming.headers);

  const reentry = await chargeReentry(limiter, presented, address, path);
  if (reentry instanceof Response) return reentry;
  const { sessionWindow } = reentry;

  const password = parseJsonObject(body)?.password;
  if (typeof password !== "string")
    return invalidRequest("The request carries no password");

  const response = await handle(
    rebuild(incoming, JSON.stringify({ password })),
  );

  if (response.ok) {
    await limiter.refund(reauthRateLimit(), presented.id, sessionWindow);
    if (change === "disable") {
      logSecurityEvent("auth.twofactor.disabled", {
        userId: presented.userId,
        address,
      });
    } else if (change === "replace-codes") {
      logSecurityEvent("auth.twofactor.codes-regenerated", {
        userId: presented.userId,
        address,
      });
    }
  } else {
    const refusal = await refusalCode(response);
    if (refusal === "INVALID_PASSWORD" || refusal === "PASSWORD_TOO_LONG") {
      logSecurityEvent("auth.reauth.refused", {
        userId: presented.userId,
        via: "two-factor",
        address,
      });
    }
  }

  return guardResponse(incoming, response);
}

/**
 * One attempt by a signed-in session, charged against both re-entry budgets
 * before Better Auth checks anything (D143): per session (`reauthRateLimit`),
 * so a stolen session cannot spend the owner's attempts, and per account
 * (`reauthAccountRateLimit`), so ten sessions are not ten budgets. Answers
 * the refusal — 429 `REAUTH_RATE_LIMITED` with `Retry-After`, or 503 when the
 * limiter cannot be reached, failing closed — or the window the session's
 * attempt landed in, for the refund a right answer earns.
 */
async function chargeReentry(
  limiter: SignInLimiter,
  presented: PresentedSession,
  address: string,
  path: string,
): Promise<{ sessionWindow: number } | Response> {
  try {
    const perSession = await limiter.consume(reauthRateLimit(), presented.id);
    const perAccount = perSession.allowed
      ? await limiter.consume(reauthAccountRateLimit(), presented.userId)
      : perSession;
    if (!perAccount.allowed) {
      const seconds = Math.max(1, Math.ceil(perAccount.retryAfterSeconds));
      logSecurityEvent("request.throttled", {
        userId: presented.userId,
        address,
        path,
        code: `retry-after=${seconds}`,
      });
      const refused = codeResponse(
        429,
        "REAUTH_RATE_LIMITED",
        "Too many attempts at the password",
      );
      refused.headers.set("retry-after", String(seconds));
      return refused;
    }
    return { sessionWindow: perSession.window };
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) throw error;
    console.error(
      "[auth] refused: the rate limiter could not reach Valkey. Check VALKEY_URL and the cache service.",
    );
    return codeResponse(
      503,
      "AUTH_UNAVAILABLE",
      "Sign-in is temporarily unavailable",
    );
  }
}

/**
 * The options of a passkey sign-in: a random challenge, and the signed
 * cookie that names it, for the browser to answer with a passkey.
 *
 * Charged per address against a budget of its own
 * (`passkeyOptionsRateLimit`): it is not a guess, but every one writes a
 * challenge row, and nothing ties it to the sign-in that may follow, so it
 * could not be given back from sign-in's budget. Takes no query.
 */
async function passkeyOptions(
  incoming: Request,
  handle: AuthEndpointHandler,
  options: AuthHandlerOptions,
): Promise<Response> {
  const limiter = options.limiter ?? valkeySignInLimiter;
  try {
    await chargeSignInAddress(
      incoming.headers,
      limiter,
      passkeyOptionsRateLimit(),
    );
  } catch (error) {
    if (error instanceof SignInRefusedError) return refusedSignIn(error);
    throw error;
  }
  return guardResponse(
    incoming,
    await handle(withoutInternalHeaders(incoming, [])),
  );
}

/**
 * A passkey sign-in: the browser's answer to the challenge (D151).
 *
 * - **Charged per address**, against sign-in's own budget, before the body
 *   is believed: the request names no account — Better Auth finds it from the
 *   passkey — and a passkey cannot be guessed, so the address is all there is
 *   to count.
 * - **The WebAuthn answer and nothing else** reaches Better Auth, with the
 *   remember-me box read as a password sign-in reads it (`rememberChoice`):
 *   the create hook takes the row's kind from `x-stoky-remember`, and the
 *   policy plugin makes an unticked box's cookie a browser cookie.
 * - **A session issued is a sign-in**: the address refunded, this browser
 *   remembered for the account, the presented session ended with the
 *   account's expired rows and any past ten (`sessions.tidy`), and
 *   `auth.signin.succeeded` with `method: "passkey"`.
 * - **A refusal** is `auth.passkey.signin-failed` with Better Auth's code —
 *   an unknown passkey, a ceremony from another address, an authenticator
 *   that did not verify the person — and stays counted.
 */
async function passkeySignIn(
  incoming: Request,
  body: Uint8Array<ArrayBuffer> | null,
  handle: AuthEndpointHandler,
  options: AuthHandlerOptions,
): Promise<Response> {
  const limiter = options.limiter ?? valkeySignInLimiter;
  const sessions = options.sessions;

  let charge: AddressCharge;
  try {
    charge = await chargeSignInAddress(incoming.headers, limiter);
  } catch (error) {
    if (error instanceof SignInRefusedError) return refusedSignIn(error);
    throw error;
  }

  const parsed = parseJsonObject(body);
  const answerToChallenge = parsed?.response;
  if (
    !answerToChallenge ||
    typeof answerToChallenge !== "object" ||
    Array.isArray(answerToChallenge)
  ) {
    logSecurityEvent("auth.passkey.signin-failed", {
      address: charge.address,
      code: "malformed",
    });
    return invalidRequest();
  }

  const previous = sessions ? await sessions.presented(incoming.headers) : null;
  const remember = await rememberChoice(parsed, options);

  const response = await handle(
    rebuild(
      incoming,
      JSON.stringify({ response: answerToChallenge }),
      remember.adjust,
    ),
  );

  if (response.ok) {
    const issued = await issuedSession(response);
    if (issued) {
      await secondFactorSucceeded(
        charge,
        {
          userId: issued.userId,
          email: issued.email,
          deviceId: deviceIdFromHeaders(incoming.headers),
        },
        "passkey",
        limiter,
      );
      if (issued.token && sessions) {
        await tidyQuietly(sessions, {
          previous,
          userId: issued.userId,
          newToken: issued.token,
        });
      }
    }
  } else if (response.status >= 400 && response.status < 500) {
    logSecurityEvent("auth.passkey.signin-failed", {
      address: charge.address,
      code: (await refusalCode(response)) ?? undefined,
    });
  }

  return remember.finish(await guardResponse(incoming, response), response.ok);
}

/**
 * A signed-in person adding, removing or renaming one of their passkeys
 * (D151): the keys the endpoint takes and nothing else, so a registration
 * never asks for a session of its own (`createSession`, which the policy
 * plugin also forces off). A name, when there is one, is checked against
 * `passkeyNameSchema` and forwarded trimmed, or the request is answered 400:
 * Better Auth only trims it, and the column it lands in has no bound. The step-up a registration or a removal needs is
 * checked by the policy plugin, inside Better Auth, where the session is
 * read; a refusal there is `STEP_UP_REQUIRED`. A success is logged with whose
 * passkey it was.
 */
async function changePasskey(
  incoming: Request,
  body: Uint8Array<ArrayBuffer> | null,
  handle: AuthEndpointHandler,
  options: AuthHandlerOptions,
  change: (typeof PASSKEY_CHANGES)[string],
): Promise<Response> {
  const parsed = parseJsonObject(body);
  if (!parsed) return invalidRequest("The request is not a passkey change");
  const kept: Record<string, unknown> = {};
  for (const key of change.keys) {
    if (key in parsed) kept[key] = parsed[key];
  }
  if ("name" in kept) {
    const name = passkeyNameSchema.safeParse(kept.name);
    if (!name.success) return invalidRequest("The passkey name is not valid");
    kept.name = name.data;
  }

  const presented =
    change.event && options.sessions
      ? await options.sessions.presented(incoming.headers)
      : null;
  const response = await handle(rebuild(incoming, JSON.stringify(kept)));

  if (response.ok && change.event) {
    logSecurityEvent(change.event, {
      userId: presented?.userId,
      address: clientAddress(incoming.headers),
    });
  }
  return guardResponse(incoming, response);
}

/** Whether a `Cookie` header holds a non-empty cookie called `name`. */
function hasCookie(header: string | null, name: string): boolean {
  if (!header) return false;
  return header.split(";").some((pair) => {
    const [key, ...value] = pair.trim().split("=");
    return key.trim() === name && value.join("=").length > 0;
  });
}

/** Whether an answer sets (not expires) the cookie called `name`. */
function setsCookie(response: Response, name: string): boolean {
  return response.headers.getSetCookie().some((line) => {
    const [pair, ...attributes] = line.split(";");
    const [key, ...value] = pair.trim().split("=");
    const expired = attributes.some((attribute) =>
      /^\s*max-age=0\s*$/i.test(attribute),
    );
    return key.trim() === name && value.join("=").length > 0 && !expired;
  });
}

/** The `code` of a refusal's JSON body, or null. */
async function refusalCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as { code?: unknown } | null;
    return typeof body?.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

/**
 * The POST Better Auth gets: the same URL without its query (nothing this
 * application sends uses one), every header but the length, which `Request`
 * restates for the new body, and `x-stoky-remember`, which only this route
 * sets (`adjust` is where it does) — and the body this route wrote.
 */
function rebuild(
  incoming: Request,
  body: string,
  adjust?: (headers: Headers) => void,
): Request {
  const url = new URL(incoming.url);
  url.search = "";
  const headers = new Headers(incoming.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.delete(REMEMBER_HEADER);
  adjust?.(headers);
  return new Request(url, {
    method: "POST",
    headers,
    body,
    signal: incoming.signal,
  });
}

/**
 * Better Auth's answer, without the session token anywhere a script can read
 * it.
 *
 * The token is the cookie's value and the cookie is `HttpOnly`; Better Auth
 * also returns it in the sign-in body (`token`) and the session body
 * (`session.token`), and the bearer plugin adds a `set-auth-token` header —
 * the signed value — to every answer that sets the cookie, a refresh
 * included, and names it in `Access-Control-Expose-Headers`. Any of them
 * hands a script on the page what `HttpOnly` exists to keep from it.
 *
 * - **The bodies lose the token always.** It is the unsigned one, which no
 *   endpoint accepts (`requireSignature`), and nothing needs it.
 * - **The header is dropped whenever the request carried a cookie**, with its
 *   entry in the expose list. A browser always carries one here — the page
 *   that sends a sign-in was rendered, which gave it `stoky_device`
 *   (`src/proxy.ts`) — while a native client keeps no cookies at all (D142):
 *   for it the header is the only way the token arrives, and it has no
 *   `HttpOnly` to defeat. A script that leaves the cookies out of its own
 *   request is answered no session to copy: it would have to sign in with the
 *   password, which it would then already have.
 */
async function guardResponse(
  incoming: Request,
  response: Response,
): Promise<Response> {
  const headers = new Headers(response.headers);

  if (incoming.headers.has("cookie")) {
    headers.delete("set-auth-token");
    const exposed = (headers.get("access-control-expose-headers") ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name && name.toLowerCase() !== "set-auth-token");
    if (exposed.length)
      headers.set("access-control-expose-headers", exposed.join(", "));
    else headers.delete("access-control-expose-headers");
  }

  let body: BodyInit | null = response.body;
  if (headers.get("content-type")?.toLowerCase().includes("application/json")) {
    const text = await response.text();
    body = text;
    try {
      const json: unknown = JSON.parse(text);
      if (json && typeof json === "object" && !Array.isArray(json)) {
        const record = json as Record<string, unknown>;
        delete record.token;
        const session = record.session;
        if (session && typeof session === "object" && !Array.isArray(session)) {
          delete (session as Record<string, unknown>).token;
        }
        body = JSON.stringify(record);
      }
    } catch {
      // Not JSON after all: passed on as it came.
    }
    headers.delete("content-length");
  }

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * A refused sign-in, as JSON the login form reads (`src/lib/auth/client.ts`):
 * the policy's code in Better Auth's upper-case style, 429 with `Retry-After`
 * for a spent budget, 503 without one when the limiter cannot be reached —
 * nothing can say when it will be back.
 */
function refusedSignIn(error: SignInRefusedError): Response {
  const status = error.code === "auth_unavailable" ? 503 : 429;
  const message =
    error.code === "auth_unavailable"
      ? "Sign-in is temporarily unavailable"
      : "Too many sign-in attempts";
  const response = codeResponse(status, error.code.toUpperCase(), message);
  if (error.retryAfterSeconds !== null) {
    response.headers.set("retry-after", String(error.retryAfterSeconds));
  }
  return response;
}

function invalidRequest(message = "The request is not a sign-in"): Response {
  return codeResponse(400, "INVALID_REQUEST", message);
}

function codeResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
