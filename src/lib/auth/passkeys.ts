import { canonicalUrl } from "@/lib/auth/public-url";

/**
 * Where passkeys can work, decided once from `STOKY_URLS` (PROGRESS D151).
 *
 * A passkey belongs to one relying party, named by a host — here the first
 * `STOKY_URLS` entry's, the canonical address (D138). The browser offers it
 * only to pages served at that host, and the server accepts its signature
 * only from that origin, so:
 *
 * - **It works at the first address alone.** Listed beside it, a LAN address
 *   or a second name signs in with the password; changing the first entry
 *   orphans every passkey, and people add new ones.
 * - **Only where WebAuthn exists.** Browsers expose it to secure contexts
 *   only: https, or http to `localhost`. A plain-HTTP LAN install has no
 *   passkeys, and its people never see the offer.
 * - **Never at an IP address.** A relying party id must be a domain name;
 *   browsers refuse an IP literal, so an install reached as
 *   `https://192.168.1.10` has none either.
 *
 * When none of that holds, the plugin is not registered at all
 * (`src/lib/auth/instance.ts`), and its endpoints answer 404 like any other
 * Better Auth endpoint the route does not open.
 *
 * Pure and environment-injected, like `public-url.ts`.
 */

type Env = Record<string, string | undefined>;

/** A hostname that is an IPv4 or IPv6 address, after `URL` has normalised it. */
function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
}

/** The canonical entry, when it is one passkeys can work at. */
function passkeyOrigin(env: Env): URL | null {
  // The address Better Auth is built with: outside production with none set,
  // `bun run dev`'s own, http://localhost:3000.
  const origin = canonicalUrl(env);
  if (!origin) return null;
  const url = new URL(origin);
  if (isIpLiteral(url.hostname)) return null;
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && url.hostname === "localhost") return url;
  return null;
}

/** Whether passkeys can work on this instance at all. */
export function passkeysAvailable(env: Env = process.env): boolean {
  return passkeyOrigin(env) !== null;
}

/** The relying party id: the canonical hostname, or null when passkeys are unavailable. */
export function passkeyRpHost(env: Env = process.env): string | null {
  return passkeyOrigin(env)?.hostname ?? null;
}

/** The one origin a passkey ceremony is accepted from, or null. */
export function passkeyRpOrigin(env: Env = process.env): string | null {
  return passkeyOrigin(env)?.origin ?? null;
}

/**
 * Whether a page served to a request for `host` (its `Host` header) should
 * offer passkeys: they are available, and the request came to the canonical
 * address — host and port, since a ceremony is accepted from that origin
 * alone. Anywhere else the browser would find no passkey to offer, or the
 * server would refuse the one it found.
 */
export function passkeyOfferedAt(
  host: string | null | undefined,
  env: Env = process.env,
): boolean {
  const origin = passkeyOrigin(env);
  if (!origin || !host) return false;
  let requested: URL;
  try {
    requested = new URL(`${origin.protocol}//${host.trim()}`);
  } catch {
    return false;
  }
  return requested.host === origin.host;
}
