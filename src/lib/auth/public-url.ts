/**
 * Saying so at start-up when the address people sign in at is not https.
 *
 * Auth.js decides per request whether the session cookie is `Secure` and
 * `__Secure-`/`__Host-` prefixed: `useSecureCookies ?? url.protocol ===
 * "https:"` (`@auth/core` `lib/init.js`). That `url` is `AUTH_URL ??
 * NEXTAUTH_URL` when one is set (`next-auth` `lib/env.js`, `reqWithEnvURL`),
 * and otherwise the request's own URL, which Next builds from the `Host` and
 * `X-Forwarded-Proto` headers. So two configurations downgrade the cookie
 * without a line in any log (security review, 2026-10-12, low; OWASP ASVS
 * 4.0.3 V3.4.1, V9.1.1):
 *
 * - **No URL at all**, behind a TLS proxy that does not send
 *   `X-Forwarded-Proto` — nginx does not by default. The person is on https,
 *   the cookie is issued without `Secure`, and any plain-http request to the
 *   host carries it in cleartext.
 * - **An `http://` URL for an address that is not this machine** — what an
 *   operator ends up with after publishing the app port on a LAN and finding
 *   the https URL's `Secure` cookies refused. Every password and every session
 *   cookie then crosses the network in cleartext.
 *
 * **A warning, never a refusal.** D84 (`docs/PROGRESS.md`) keeps a plain-http
 * LAN install working on purpose, and `src/proxy.ts` drops the device cookie's
 * `Secure` flag and `upgrade-insecure-requests` for it; refusing to start would
 * reverse that decision and stop every such install on upgrade. Forcing
 * `useSecureCookies` instead would make sign-in impossible there: the browser
 * drops a `Secure` cookie set over http, which is the sign-in loop that pushes
 * an operator to an http URL in the first place.
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
  /** Neither variable is set (or the one next-auth reads is empty). */
  | { kind: "missing" }
  /** Set, but not something next-auth can parse. */
  | { kind: "unparsable"; variable: PublicUrlVariable }
  /** Parsed, but neither http nor https. */
  | { kind: "other-scheme"; variable: PublicUrlVariable; protocol: string }
  | { kind: "https"; origin: string }
  /** http to this machine: a secure context, and the cookie stays local. */
  | { kind: "loopback-http"; origin: string }
  /** http to anywhere else: cleartext on the network. */
  | { kind: "insecure-http"; variable: PublicUrlVariable; origin: string };

export type PublicUrlVariable = "AUTH_URL" | "NEXTAUTH_URL";

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

/**
 * Which URL next-auth will use, and what it means.
 *
 * `AUTH_URL ?? NEXTAUTH_URL`, exactly next-auth's own precedence: an empty
 * `AUTH_URL` hides `NEXTAUTH_URL` there too, and is reported as missing
 * because that is what next-auth then does with it.
 */
export function classifyPublicUrl(env: Record<string, string | undefined>): PublicUrlState {
  const variable: PublicUrlVariable = env.AUTH_URL !== undefined ? "AUTH_URL" : "NEXTAUTH_URL";
  const raw = env.AUTH_URL ?? env.NEXTAUTH_URL;
  if (!raw) return { kind: "missing" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "unparsable", variable };
  }

  // The origin, never the raw value: it drops any `user:password@` and path.
  const { origin } = url;
  if (url.protocol === "https:") return { kind: "https", origin };
  if (url.protocol !== "http:") {
    return { kind: "other-scheme", variable, protocol: url.protocol };
  }
  if (isLoopbackHostname(url.hostname)) return { kind: "loopback-http", origin };
  return { kind: "insecure-http", variable, origin };
}

/** Where to go instead, shared by the warnings about transport. */
const TLS_ROUTE =
  "Put TLS in front — the release bundle, your own proxy setting X-Forwarded-Proto and X-Forwarded-For, or `tailscale serve` — and set NEXTAUTH_URL to that https address.";

/**
 * The warning for this configuration, in words an operator can act on, or
 * null. Production only: development and the suites use whatever is to hand.
 */
export function publicUrlWarning(
  env: Record<string, string | undefined>,
): string | null {
  if (env.NODE_ENV !== "production") return null;

  const state = classifyPublicUrl(env);
  switch (state.kind) {
    case "https":
    case "loopback-http":
      return null;
    case "missing":
      return `[auth] warning: neither AUTH_URL nor NEXTAUTH_URL is set, so each request's Host and X-Forwarded-Proto headers decide this instance's address. Behind a proxy that does not send X-Forwarded-Proto: https, the session cookie is issued without Secure and any plain-http request to this host carries it in cleartext. ${TLS_ROUTE}`;
    case "unparsable":
      // `reqWithEnvURL` calls `new URL()` on it, uncaught, for every request
      // to the auth handlers: measured, `stoky.example.com` throws
      // `TypeError: Invalid URL` there.
      return `[auth] warning: ${state.variable} is not a URL (a missing https:// is the usual cause). next-auth parses it on every authentication request and fails, so nobody can sign in. Set it to the https address people use, or remove it.`;
    case "other-scheme":
      return `[auth] warning: ${state.variable} is a ${state.protocol} URL; it must be https, or http only for this machine. The session cookie is not marked Secure. ${TLS_ROUTE}`;
    case "insecure-http":
      return `[auth] warning: ${state.variable} is ${state.origin}, plain HTTP to an address that is not this machine. The session cookie is not marked Secure, and everyone who signs in at that address sends their password and session cookie across the network in cleartext. Browsers also treat a page there as insecure, so the barcode camera and offline support are unavailable. ${TLS_ROUTE}`;
  }
}
