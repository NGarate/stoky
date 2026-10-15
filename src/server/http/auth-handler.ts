import { clientAddress } from "@/lib/rate-limit";
import { logSecurityEvent } from "@/lib/security-log";
import {
  SignInRefusedError,
  chargeSignInAttempt,
  signInFailed,
  signInSucceeded,
  valkeySignInLimiter,
  type SignInLimiter,
} from "@/lib/auth/sign-in-policy";
import type { PresentedSession, SignInTidy } from "@/lib/auth/sign-in-tidy";
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
 *    and this application uses five. Anything else is 404 before Better Auth
 *    sees it, so an endpoint a future version adds is closed until somebody
 *    decides otherwise. `disabledPaths` is not used: it is a denylist.
 * 2. **The body, bounded** (`readBodyWithin`, 64 KiB), before anything is
 *    parsed.
 * 3. **Fetch Metadata** on a POST (`refuseCrossSite`).
 * 4. **JSON only** on a POST (`refuseNonJson`): Better Auth also takes a form
 *    post on sign-in, which a page on another origin can send without a
 *    preflight.
 * 5. **Only the body keys each endpoint needs**, rebuilt rather than passed:
 *    a sign-in carries an address, a password and `rememberMe: false`, and
 *    nothing — no `callbackURL` — that Better Auth would act on.
 * 6. **Our limits** (`src/lib/auth/sign-in-policy.ts`), charged before the
 *    JSON is believed, so a body that does not parse is still an attempt.
 * 7. **Better Auth.**
 * 8. **The response, guarded:** the session token is the cookie's value, and
 *    no script on the page needs it in a body or a header.
 *
 * A sign-in that gets in is followed by its tidy (`sessions.tidy`): the
 * session the browser presented ends, and the account's expired rows go
 * (`src/lib/auth/sign-in-tidy.ts`, D139).
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
}

export interface SignInSessions {
  /**
   * The valid session a request carries, or null — read before Better Auth
   * answers the sign-in, so it is the session being replaced.
   */
  presented: (headers: Headers) => Promise<PresentedSession | null>;
  /** Ends what a sign-in replaces (`tidyAfterSignIn`). */
  tidy: (input: SignInTidy) => Promise<unknown>;
}

export const AUTH_BASE_PATH = "/api/auth";

/**
 * Every endpoint the auth API answers, as "METHOD /path" under
 * `AUTH_BASE_PATH`. Adding one is a decision about what an unauthenticated
 * caller may reach.
 */
export const ALLOWED_AUTH_ENDPOINTS: ReadonlySet<string> = new Set([
  "POST /sign-in/email",
  "POST /sign-out",
  "GET /get-session",
  "GET /ok",
  "GET /error",
]);

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
    return signIn(
      incoming,
      body,
      handle,
      options.limiter ?? valkeySignInLimiter,
      options.sessions,
    );
  }
  if (endpoint === "POST /sign-out") {
    // It takes nothing this application uses.
    return guardResponse(incoming, await handle(rebuild(incoming, "{}")));
  }
  return guardResponse(incoming, await handle(incoming));
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
 */
async function signIn(
  incoming: Request,
  body: Uint8Array<ArrayBuffer> | null,
  handle: AuthEndpointHandler,
  limiter: SignInLimiter,
  sessions: SignInSessions | undefined,
): Promise<Response> {
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

  const response = await handle(
    rebuild(
      incoming,
      // `rememberMe: false` until the form can ask (a later commit): a browser
      // session, whose cookie ends with the browser and whose row the create
      // hook bounds (`src/lib/auth/instance.ts`). Better Auth reads a missing
      // value as true.
      JSON.stringify({ email: attempt.email, password, rememberMe: false }),
    ),
  );

  if (response.ok) {
    const issued = await issuedSession(response);
    if (issued) {
      await signInSucceeded(attempt, issued.userId, "password", limiter);
      if (issued.token && sessions) {
        await tidyQuietly(sessions, { previous, userId: issued.userId, newToken: issued.token });
      }
    }
  } else if (response.status >= 400 && response.status < 500) {
    signInFailed(attempt);
  }

  return guardResponse(incoming, response);
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
): Promise<{ userId: string; token: string | null } | null> {
  try {
    const body = (await response.clone().json()) as {
      user?: { id?: unknown };
      token?: unknown;
      session?: { token?: unknown };
    } | null;
    if (typeof body?.user?.id !== "string") return null;
    const token = typeof body.token === "string" ? body.token : body.session?.token;
    return { userId: body.user.id, token: typeof token === "string" && token ? token : null };
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
  try {
    await sessions.tidy(input);
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[auth] error the sign-in tidy failed: ${reason.replace(/\s+/g, " ").slice(0, 300)}`);
  }
}

/**
 * The POST Better Auth gets: the same URL without its query (nothing this
 * application sends uses one), every header but the length, which `Request`
 * restates for the new body, and the body this route wrote.
 */
function rebuild(incoming: Request, body: string): Request {
  const url = new URL(incoming.url);
  url.search = "";
  const headers = new Headers(incoming.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return new Request(url, { method: "POST", headers, body, signal: incoming.signal });
}

/**
 * Better Auth's answer, without the session token anywhere a script can read
 * it.
 *
 * The token is the cookie's value and the cookie is `HttpOnly`; Better Auth
 * also returns it in the sign-in body (`token`) and the session body
 * (`session.token`), and a bearer plugin would add a `set-auth-token` header.
 * Any of them hands a script on the page what `HttpOnly` exists to keep from
 * it. The header is dropped whenever the request carried a cookie — a
 * browser; a client that sends none has no `HttpOnly` to defeat.
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
