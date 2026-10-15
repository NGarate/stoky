/**
 * The address this instance is reached at, and saying so at start-up when it
 * is missing or plain HTTP.
 *
 * `NEXTAUTH_URL` is the one variable that names it (commit 15 of the Better
 * Auth migration renames it). Better Auth is handed it as `baseURL`
 * (`src/lib/auth/instance.ts`) and decides three things from it, once, when the
 * instance is built — never from a request's `Host` or `X-Forwarded-Proto`:
 *
 * - **Whether the session cookie is `Secure`** and `__Secure-` prefixed:
 *   exactly when this is an https URL (`useSecureCookies`).
 * - **Which `Origin` the auth API accepts** a cookie-bearing POST from: this
 *   URL's origin, plus `DEV_ALLOWED_ORIGIN`'s hosts outside production.
 * - **The links it builds**, of which there are none today.
 *
 * So a missing URL in production is refused rather than guessed: the server
 * refuses to start until it is set (`src/lib/auth/environment.ts`, PROGRESS
 * D136), because the guess Better Auth would otherwise make — the request's
 * own headers — is the one that issued a session cookie without `Secure`
 * behind a TLS proxy that does not send `X-Forwarded-Proto` (security review,
 * 2026-10-12; OWASP ASVS 4.0.3 V3.4.1, V9.1.1).
 *
 * **Plain http to another machine is a warning, never a refusal.** D84
 * (`docs/PROGRESS.md`) keeps a plain-http LAN install working on purpose, and
 * `src/proxy.ts` drops the device cookie's `Secure` flag and
 * `upgrade-insecure-requests` for it; refusing to start would reverse that
 * decision and stop every such install on upgrade. Forcing `Secure` instead
 * would make sign-in impossible there: the browser drops a `Secure` cookie set
 * over http, which is the sign-in loop that pushes an operator to an http URL
 * in the first place.
 *
 * **Loopback http is not warned about.** `localhost`, `*.localhost`,
 * `127.0.0.0/8` and `[::1]` are what browsers treat as potentially
 * trustworthy, so the cookie never leaves the machine and the page is a secure
 * context. CI, the in-image gate and the browser suite all serve a production
 * build at one of them, and a warning there would be noise nobody acts on.
 *
 * Pure and environment-injected, so the tests need not touch `process.env`.
 */

/** What the configured public URL means for transport security. */
export type PublicUrlState =
  /** `NEXTAUTH_URL` is not set, or is empty. */
  | { kind: "missing" }
  /** Set, but not a URL. */
  | { kind: "unparsable" }
  /** Parsed, but neither http nor https. */
  | { kind: "other-scheme"; protocol: string }
  | { kind: "https"; origin: string }
  /** http to this machine: a secure context, and the cookie stays local. */
  | { kind: "loopback-http"; origin: string }
  /** http to anywhere else: cleartext on the network. */
  | { kind: "insecure-http"; origin: string };

/**
 * Where Better Auth is told it lives when nothing says otherwise: `bun run
 * dev`'s own address. Never used in production, where a missing URL refuses.
 */
export const DEVELOPMENT_URL = "http://localhost:3000";

/**
 * The hostnames browsers treat as this machine, after `URL` has normalised
 * them (`127.1` becomes `127.0.0.1`, `[0:0::1]` becomes `[::1]`).
 *
 * Not `0.0.0.0`: a browser does not count it as potentially trustworthy, so a
 * page served at it is not a secure context.
 */
function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    hostname === "[::1]"
  );
}

/** What `NEXTAUTH_URL` is, and what it means. */
export function classifyPublicUrl(env: Record<string, string | undefined>): PublicUrlState {
  const raw = env.NEXTAUTH_URL;
  if (!raw) return { kind: "missing" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "unparsable" };
  }

  // The origin, never the raw value: it drops any `user:password@` and path.
  const { origin } = url;
  if (url.protocol === "https:") return { kind: "https", origin };
  if (url.protocol !== "http:") return { kind: "other-scheme", protocol: url.protocol };
  if (isLoopbackHostname(url.hostname)) return { kind: "loopback-http", origin };
  return { kind: "insecure-http", origin };
}

/**
 * The URL Better Auth is built with: `NEXTAUTH_URL`, or `DEVELOPMENT_URL`
 * outside production. `null` in production with none set, which
 * `assertAuthEnvironment` refuses before anything reads it.
 */
export function publicUrl(env: Record<string, string | undefined>): string | null {
  if (env.NEXTAUTH_URL) return env.NEXTAUTH_URL;
  return env.NODE_ENV === "production" ? null : DEVELOPMENT_URL;
}

/** Where to go instead, shared by the warnings about transport. */
const TLS_ROUTE =
  "Put TLS in front — the release bundle, your own proxy setting X-Forwarded-For, or `tailscale serve` — and set NEXTAUTH_URL to that https address.";

/**
 * The warning for this configuration, in words an operator can act on, or
 * null. Production only: development and the suites use whatever is to hand.
 *
 * Nothing for a URL that is missing or not a URL: the server refuses to start
 * on those, with a line of its own (`authEnvironmentProblems`), and a warning
 * beside it would only say the same thing twice.
 */
export function publicUrlWarning(
  env: Record<string, string | undefined>,
): string | null {
  if (env.NODE_ENV !== "production") return null;

  const state = classifyPublicUrl(env);
  switch (state.kind) {
    case "https":
    case "loopback-http":
    case "missing":
    case "unparsable":
      return null;
    case "other-scheme":
      return `[auth] warning: NEXTAUTH_URL is a ${state.protocol} URL; it must be https, or http only for this machine. The session cookie is not marked Secure. ${TLS_ROUTE}`;
    case "insecure-http":
      return `[auth] warning: NEXTAUTH_URL is ${state.origin}, plain HTTP to an address that is not this machine. The session cookie is not marked Secure, and everyone who signs in at that address sends their password and session cookie across the network in cleartext. Browsers also treat a page there as insecure, so the barcode camera and offline support are unavailable. ${TLS_ROUTE}`;
  }
}
