import { URLS_VARIABLE, readRenamed } from "@/lib/env-names";

/**
 * The addresses this instance is reached at, what they decide, and saying so
 * at start-up when they are missing, malformed or plain HTTP (PROGRESS D138).
 *
 * `STOKY_URLS` is a comma-separated list of the URLs people type to reach this
 * instance. `NEXTAUTH_URL`, its name before the `STOKY_` rename, is still read
 * when it is unset, as a list of one (`src/lib/env-names.ts`, D137). Better
 * Auth is built from the list once, when the instance is built
 * (`src/lib/auth/instance.ts`) — never from a request's `Host` or
 * `X-Forwarded-Proto`:
 *
 * - **The first entry is canonical.** It is Better Auth's `baseURL`, and it
 *   alone decides **whether the session cookie is `Secure`** and `__Secure-`
 *   prefixed: exactly when it is https. The passkey relying party is its host
 *   too, so a passkey works only there (`src/lib/auth/passkeys.ts`, D151).
 * - **Every entry's origin is trusted** to send a cookie-bearing POST to the
 *   auth API. In production nothing else is; outside production each
 *   `DEV_ALLOWED_ORIGIN` host is added too, the two ways
 *   `docs/LOCAL_BOOTSTRAP.md` reaches a development server from a phone.
 *
 * Before the list, a plain-HTTP LAN install reached both by name and by
 * address answered 403 at whichever one the single URL did not name.
 *
 * **Refused in production**, at start-up (`src/lib/auth/environment.ts`, D136):
 *
 * - **no entry.** Guessing the address from the request is the downgrade that
 *   issued a session cookie without `Secure` behind a TLS proxy that does not
 *   send `X-Forwarded-Proto` (security review, 2026-10-12; OWASP ASVS 4.0.3
 *   V3.4.1, V9.1.1);
 * - **an entry that is not an http(s) origin**: empty, not a URL, another
 *   scheme, or carrying a path, query, fragment or credentials. An origin is
 *   all that is compared, so anything more is a misunderstanding to correct,
 *   not a detail to drop silently;
 * - **an https first entry beside plain HTTP to another machine.** The cookie
 *   is `Secure` because of the first, and a browser drops a `Secure` cookie
 *   set over plain HTTP: signing in at the other address would land back on
 *   the login page every time. Loopback http is accepted beside it, because
 *   Chromium and Firefox accept a `Secure` cookie on localhost.
 *
 * Outside production these are warnings, except a first entry that is not an
 * http(s) URL at all, which is refused everywhere: Better Auth cannot be built
 * from it, and would say so in words about itself rather than the variable.
 *
 * **Plain http to another machine is a warning, never a refusal.** D84
 * (`docs/PROGRESS.md`) keeps a plain-http LAN install working on purpose, and
 * `src/proxy.ts` drops the device cookie's `Secure` flag and
 * `upgrade-insecure-requests` for it; refusing to start would reverse that
 * decision and stop every such install on upgrade.
 *
 * **Loopback http is not warned about.** `localhost`, `*.localhost`,
 * `127.0.0.0/8` and `[::1]` are what browsers treat as potentially
 * trustworthy, so the cookie never leaves the machine and the page is a secure
 * context. CI, the in-image gate and the browser suite all serve a production
 * build at one of them, and a warning there would be noise nobody acts on.
 *
 * No message ever prints an entry as written, only its origin: a
 * `user:password@` in a URL is someone's password, and the log outlives the
 * file it came from.
 *
 * Pure and environment-injected, so the tests need not touch `process.env`.
 */

type Env = Record<string, string | undefined>;

/** What one entry of the list is, and what it means for transport security. */
export type PublicUrlEntry =
  /** Nothing between two commas, or after the last. */
  | { kind: "empty" }
  /** Not a URL. */
  | { kind: "unparsable" }
  /** A URL, but neither http nor https. */
  | { kind: "other-scheme"; protocol: string }
  /** http(s), but with a path, query, fragment or credentials. */
  | { kind: "not-an-origin"; origin: string }
  | { kind: "https"; origin: string }
  /** http to this machine: a secure context, and the cookie stays local. */
  | { kind: "loopback-http"; origin: string }
  /** http to anywhere else: cleartext on the network. */
  | { kind: "insecure-http"; origin: string };

/** The list as configured, and the variable it was read from. */
export interface PublicUrls {
  /**
   * `STOKY_URLS`, or `NEXTAUTH_URL` when only that is set — the line an
   * operator should edit. `STOKY_URLS` when neither is.
   */
  variable: string;
  /** Each comma-separated entry, trimmed. None when the variable is unset. */
  entries: string[];
}

/**
 * Where Better Auth is told it lives when nothing says otherwise: `bun run
 * dev`'s own address. Never used in production, where a missing list refuses.
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

/** The entries of `STOKY_URLS`, or of `NEXTAUTH_URL` when only that is set. */
export function parsePublicUrls(env: Env): PublicUrls {
  const { value, name } = readRenamed(env, URLS_VARIABLE);
  if (value === undefined) return { variable: name, entries: [] };
  return {
    variable: name,
    entries: value.split(",").map((entry) => entry.trim()),
  };
}

/** What one entry is. */
export function classifyUrl(raw: string): PublicUrlEntry {
  if (raw === "") return { kind: "empty" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "unparsable" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "other-scheme", protocol: url.protocol };
  }
  // The origin, never the raw value: it drops any `user:password@` and path.
  const { origin } = url;
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    return { kind: "not-an-origin", origin };
  }
  if (url.protocol === "https:") return { kind: "https", origin };
  if (isLoopbackHostname(url.hostname))
    return { kind: "loopback-http", origin };
  return { kind: "insecure-http", origin };
}

/** What each entry is, in order. Empty when the variable is unset. */
export function classifyPublicUrls(env: Env): PublicUrlEntry[] {
  return parsePublicUrls(env).entries.map(classifyUrl);
}

/** The entry's origin, when it has one worth comparing. */
function originOf(entry: PublicUrlEntry): string | null {
  return "origin" in entry ? entry.origin : null;
}

/**
 * The URL Better Auth is built with: the first entry's origin, or
 * `DEVELOPMENT_URL` outside production with none set. `null` in production
 * with none set, or when the first entry has no origin — both of which
 * `assertAuthEnvironment` refuses before anything reads it.
 */
export function canonicalUrl(env: Env): string | null {
  const [first] = classifyPublicUrls(env);
  if (!first) return env.NODE_ENV === "production" ? null : DEVELOPMENT_URL;
  return originOf(first);
}

/**
 * The origins a signed-in browser may POST to the auth API from: every entry's,
 * once each, the canonical first. Outside production, also each
 * `DEV_ALLOWED_ORIGIN` host at the dev server's port over http and behind
 * `tailscale serve` over https. Production never reads `DEV_ALLOWED_ORIGIN`
 * here.
 */
export function trustedAuthOrigins(env: Env): string[] {
  const origins = classifyPublicUrls(env)
    .map(originOf)
    .filter((origin): origin is string => origin !== null);
  if (env.NODE_ENV !== "production") {
    if (origins.length === 0) origins.push(DEVELOPMENT_URL);
    const port = env.PORT || "3000";
    for (const host of (env.DEV_ALLOWED_ORIGIN ?? "").split(",")) {
      const name = host.trim();
      if (!name) continue;
      origins.push(`http://${name}:${port}`, `https://${name}`);
    }
  }
  return [...new Set(origins)];
}

/** One thing wrong with the list, and whether it is refused outside production. */
export interface PublicUrlProblem {
  message: string;
  /**
   * Refused in every environment: the first entry is not an http(s) URL, so
   * Better Auth could not be built from it. Every other problem is refused in
   * production and warned about elsewhere.
   */
  everywhere: boolean;
}

/** How a message names an entry: the variable alone when it holds one. */
function entryName(variable: string, index: number, count: number): string {
  return count === 1 ? variable : `${variable} entry ${index + 1}`;
}

/**
 * Everything wrong with the list, in words an operator can act on, without a
 * prefix. "Not set" only in production, where nothing is guessed.
 */
export function publicUrlProblems(env: Env): PublicUrlProblem[] {
  const { variable, entries } = parsePublicUrls(env);
  if (entries.length === 0) {
    return env.NODE_ENV === "production"
      ? [
          {
            message: `${variable} is not set. Set it to the https address people use — or every address, comma-separated, the canonical one first. Sign-in is accepted only from those origins, and the session cookie is marked Secure only when the first is https.`,
            everywhere: false,
          },
        ]
      : [];
  }

  const problems: PublicUrlProblem[] = [];
  const classified = entries.map(classifyUrl);
  classified.forEach((entry, index) => {
    const name = entryName(variable, index, entries.length);
    const everywhere = index === 0;
    switch (entry.kind) {
      case "empty":
        problems.push({
          message: `${name} is empty. Remove the extra comma.`,
          everywhere,
        });
        break;
      case "unparsable":
        problems.push({
          message: `${name} is not a URL (a missing https:// is the usual cause). Write each address as https://host, or http://host:port.`,
          everywhere,
        });
        break;
      case "other-scheme":
        problems.push({
          message: `${name} uses the ${entry.protocol.replace(/:$/, "")} scheme. Each address must be https, or http.`,
          everywhere,
        });
        break;
      case "not-an-origin":
        problems.push({
          message: `${name} has a path, query, fragment or credentials. List the address alone: ${entry.origin}.`,
          everywhere: false,
        });
        break;
    }
  });

  if (classified[0]?.kind === "https") {
    for (const entry of classified) {
      if (entry.kind !== "insecure-http") continue;
      problems.push({
        message: `${variable} starts with an https address but also lists ${entry.origin}, plain HTTP to another machine. The session cookie is marked Secure because of the first entry, and a browser drops a Secure cookie over plain HTTP, so signing in there would loop back to the login page. Serve that address over https too, or remove it.`,
        everywhere: false,
      });
    }
  }
  return problems;
}

/** Where to go instead, shared by the warnings about transport. */
const TLS_ROUTE = (variable: string) =>
  `Put TLS in front — the release bundle, your own proxy setting X-Forwarded-For, or \`tailscale serve\` — and list that https address in ${variable}.`;

/**
 * The warnings for this configuration, in words an operator can act on, one
 * per line. Production only: development and the suites use whatever is to
 * hand.
 *
 * Nothing for a list that is missing or malformed: the server refuses to start
 * on those, with a line of its own (`publicUrlProblems`), and a warning beside
 * it would only say the same thing twice.
 */
export function publicUrlWarnings(env: Env): string[] {
  if (env.NODE_ENV !== "production") return [];

  const { variable, entries } = parsePublicUrls(env);
  const classified = entries.map(classifyUrl);
  const warnings: string[] = [];
  classified.forEach((entry, index) => {
    if (entry.kind !== "insecure-http") return;
    const name = entryName(variable, index, entries.length);
    warnings.push(
      `[auth] warning: ${name} is ${entry.origin}, plain HTTP to an address that is not this machine. The session cookie is not marked Secure, and everyone who signs in at that address sends their password and session cookie across the network in cleartext. Browsers also treat a page there as insecure, so the barcode camera and offline support are unavailable. ${TLS_ROUTE(variable)}`,
    );
  });

  // The first entry decides `Secure` for every address, so an https address
  // listed after an http one gets a cookie that is not Secure either.
  if (classified[0] && classified[0].kind !== "https") {
    for (const entry of classified.slice(1)) {
      if (entry.kind !== "https") continue;
      warnings.push(
        `[auth] warning: ${variable} lists ${entry.origin}, but its first entry is not https, and only the first decides whether the session cookie is marked Secure: it is not, at that address either. List the https address first, and only https addresses beside it.`,
      );
    }
  }
  return warnings;
}
