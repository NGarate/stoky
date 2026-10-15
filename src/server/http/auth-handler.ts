import { clientAddress } from "@/lib/rate-limit";
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
 *    and this application uses seven. Anything else is 404 before Better Auth
 *    sees it, so an endpoint a future version adds is closed until somebody
 *    decides otherwise. `disabledPaths` is not used: it is a denylist.
 * 2. **The body, bounded** (`readBodyWithin`, 64 KiB), before anything is
 *    parsed.
 * 3. **Fetch Metadata** on a POST (`refuseCrossSite`).
 * 4. **JSON only** on a POST (`refuseNonJson`): Better Auth also takes a form
 *    post on sign-in, which a page on another origin can send without a
 *    preflight.
 * 5. **Only the body keys each endpoint needs**, rebuilt rather than passed:
 *    a sign-in carries an address, a password and `rememberMe`, and nothing —
 *    no `callbackURL` — that Better Auth would act on; a second step carries
 *    its `code` and nothing else, so no `trustDevice` (a cookie that skips the
 *    code for a month) and no `disableSession` (a backup code spent without
 *    a session to show for it). `x-stoky-remember` is
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
 * Better Auth clears that cookie only at a sign-out or a read that finds the
 * session gone, never at a ticked sign-in, and while the browser holds it
 * Better Auth treats every session there as not remembered.
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
 * only when it carried the challenge and was answered with a session.
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
  // The second step of a sign-in, and nothing else of two-step verification
  // yet (D148): enrolment opens with the settings screen, never
  // `/two-factor/get-totp-uri` (it hands the secret back to anyone holding
  // the session).
  "POST /two-factor/verify-totp",
  "POST /two-factor/verify-backup-code",
  "POST /sign-out",
  "GET /get-session",
  "GET /ok",
  "GET /error",
]);

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

async function answer(incoming: Request, options: AuthHandlerOptions): Promise<Response> {
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

    const refused = refuseCrossSite(incoming, AUTH_BASE_PATH) ?? refuseNonJson(incoming);
    if (refused) return refused;
  }

  let handle: AuthEndpointHandler;
  try {
    handle = options.handler();
  } catch (error) {
    // The instance refused this environment (`assertAuthEnvironment`). Said
    // in prose for the operator and as an event for the log's readers; the
    // caller learns only that sign-in is unavailable.
    logSecurityEvent("auth.unavailable", { address: clientAddress(incoming.headers) });
    console.error(error instanceof Error ? error.message : error);
    return codeResponse(503, "AUTH_UNAVAILABLE", "Sign-in is temporarily unavailable");
  }

  if (endpoint === "POST /sign-in/email") {
    return signIn(incoming, body, handle, options);
  }
  const secondStepMethod = SECOND_STEPS[endpoint];
  if (secondStepMethod) {
    return secondStep(incoming, body, handle, options, secondStepMethod);
  }
  if (endpoint === "POST /sign-out") {
    // It takes nothing this application uses.
    return guardResponse(incoming, await handle(rebuild(incoming, "{}")));
  }
  return guardResponse(incoming, await handle(withoutInternalHeaders(incoming)));
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
    attempt = await chargeSignInAttempt(incoming.headers, parsed?.email, limiter);
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

  // Exactly `true`, nothing else: Better Auth reads a missing value as true.
  const rememberMe = parsed?.rememberMe === true;
  const dontRemember = rememberMe && options.dontRememberCookie
    ? await options.dontRememberCookie()
    : null;

  const response = await handle(
    rebuild(incoming, JSON.stringify({ email: attempt.email, password, rememberMe }), (headers) => {
      headers.set(REMEMBER_HEADER, rememberMe ? "1" : "0");
      if (dontRemember) {
        const cookie = withoutCookie(headers.get("cookie"), dontRemember.name);
        if (cookie) headers.set("cookie", cookie);
        else headers.delete("cookie");
      }
    }),
  );

  if (response.ok) {
    const issued = await issuedSession(response);
    if (issued) {
      await signInSucceeded(attempt, issued.userId, "password", limiter);
      if (issued.token && sessions) {
        await tidyQuietly(sessions, { previous, userId: issued.userId, newToken: issued.token });
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

  const answer = await guardResponse(incoming, response);
  if (dontRemember && response.ok) {
    answer.headers.append(
      "set-cookie",
      `${dontRemember.name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${
        dontRemember.secure ? "; Secure" : ""
      }`,
    );
  }
  return answer;
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
 * not reach Better Auth's hooks on any path.
 *
 * Made from the URL, not as `new Request(incoming, { headers })`: Bun 1.4.3
 * keeps the original headers when the replacement is empty, so a request
 * whose only header was this one would keep it.
 */
function withoutInternalHeaders(incoming: Request): Request {
  if (!incoming.headers.has(REMEMBER_HEADER)) return incoming;
  const headers = new Headers(incoming.headers);
  headers.delete(REMEMBER_HEADER);
  return new Request(incoming.url, { method: incoming.method, headers, signal: incoming.signal });
}

/** The JSON object a body holds, or null for anything else. */
function parseJsonObject(body: Uint8Array<ArrayBuffer> | null): Record<string, unknown> | null {
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
async function issuedSession(
  response: Response,
): Promise<{ userId: string; email: string | undefined; token: string | null } | null> {
  try {
    const body = (await response.clone().json()) as {
      user?: { id?: unknown; email?: unknown };
      token?: unknown;
      session?: { token?: unknown };
    } | null;
    if (typeof body?.user?.id !== "string") return null;
    const token = typeof body.token === "string" ? body.token : body.session?.token;
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
async function tidyQuietly(sessions: SignInSessions, input: SignInTidy): Promise<void> {
  await quietly("the sign-in tidy", () => sessions.tidy(input));
}

/**
 * Runs `work` after an answer has been decided, logging rather than throwing
 * if it fails: what it would have ended still ends on its own clock.
 */
async function quietly(what: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[auth] error ${what} failed: ${reason.replace(/\s+/g, " ").slice(0, 300)}`);
  }
}

/** Whether Better Auth answered a right password with "now the code" (D148). */
async function asksForSecondStep(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { twoFactorRedirect?: unknown } | null;
    return body?.twoFactorRedirect === true;
  } catch {
    return false;
  }
}

/**
 * A second step: an authenticator code or a backup code, after a password
 * step that asked for one (D148).
 *
 * - **Charged per address only**, before the body is believed: the request
 *   names no account — only the challenge cookie does, and only Better Auth
 *   reads it — and Better Auth counts wrong codes itself, five per
 *   challenge and ten per account.
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
 *   `locked`. An unreadable secret or a replayed code was already written by
 *   the guard that refused it (`src/lib/auth/policy-plugin.ts`); a replay is
 *   also a failed code, and is written as one too.
 */
async function secondStep(
  incoming: Request,
  body: Uint8Array<ArrayBuffer> | null,
  handle: AuthEndpointHandler,
  options: AuthHandlerOptions,
  method: "totp" | "backup-code",
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

  const code = parseJsonObject(body)?.code;
  if (typeof code !== "string") {
    logSecurityEvent("auth.twofactor.failed", { address: charge.address, code: "malformed" });
    return invalidRequest();
  }

  const names = options.twoFactorCookies ? await options.twoFactorCookies() : null;
  const carriedChallenge = names ? hasCookie(incoming.headers.get("cookie"), names.challenge) : false;
  const previous = sessions ? await sessions.presented(incoming.headers) : null;

  const response = await handle(rebuild(incoming, JSON.stringify({ code })));

  if (response.ok) {
    const setsSession = names ? setsCookie(response, names.session) : false;
    const issued = setsSession ? await issuedSession(response) : null;
    if (issued && carriedChallenge && !previous) {
      await secondFactorSucceeded(
        charge,
        { userId: issued.userId, email: issued.email, deviceId: deviceIdFromHeaders(incoming.headers) },
        method,
        limiter,
      );
      if (issued.token && sessions) {
        await tidyQuietly(sessions, { previous: null, userId: issued.userId, newToken: issued.token });
      }
    } else if (issued && previous && method === "totp") {
      logSecurityEvent("auth.twofactor.enabled", { userId: previous.userId, address: charge.address });
    }
  } else {
    const refusal = await refusalCode(response);
    if (refusal === "ACCOUNT_TEMPORARILY_LOCKED") {
      logSecurityEvent("auth.twofactor.locked", { address: charge.address, code: refusal });
    } else if (refusal !== "TWO_FACTOR_UNREADABLE" && response.status >= 400 && response.status < 500) {
      logSecurityEvent("auth.twofactor.failed", { address: charge.address, code: refusal ?? undefined });
    }
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
    const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
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
  return new Request(url, { method: "POST", headers, body, signal: incoming.signal });
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
async function guardResponse(incoming: Request, response: Response): Promise<Response> {
  const headers = new Headers(response.headers);

  if (incoming.headers.has("cookie")) {
    headers.delete("set-auth-token");
    const exposed = (headers.get("access-control-expose-headers") ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name && name.toLowerCase() !== "set-auth-token");
    if (exposed.length) headers.set("access-control-expose-headers", exposed.join(", "));
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

  return new Response(body, { status: response.status, statusText: response.statusText, headers });
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

function invalidRequest(): Response {
  return codeResponse(400, "INVALID_REQUEST", "The request is not a sign-in");
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
