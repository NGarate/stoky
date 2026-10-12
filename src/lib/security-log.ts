/**
 * The security log — OWASP ASVS **V7.1.3**.
 *
 * V7.1.3 asks that an application log its security-relevant events: failed
 * authentication, access-control failures, and the rest. This one logged
 * almost none of them. A refused sign-in returned `null` and said nothing; a
 * request for another household's receipt was refused at the caller and left
 * no trace on the server at all. On a self-hosted box, that means the one
 * question an owner will actually ask — "has anybody been trying to get into
 * my instance?" — had no answer anywhere, and the first evidence of a break-in
 * would have been the data changing.
 *
 * **One line of JSON per event, on stderr.** Not a file, not a table: the
 * deployment is Docker, so stderr is already collected and reachable with
 * `docker compose logs` — and rotated only because the release bundle sets a
 * size cap on every service (Docker's default keeps everything; SECURITY.md,
 * "Refusals are recorded") — and JSON means `| jq 'select(.event ==
 * "access.denied")'` works without anybody installing anything. A log table in
 * Postgres would need migrations, retention and a way to read it when the
 * database is the thing that is wrong.
 *
 * **What is deliberately not in a line.** No password, no hash, no token, no
 * session cookie, and no request body — an audit log that quotes the input is
 * a second copy of the credential. Addresses and identifiers are in, because
 * they are what makes a line actionable and the operator already owns the
 * database they came from.
 */

/** The events worth a line. Kept as a closed union so greps stay reliable. */
export type SecurityEvent =
  | "auth.signin.failed"
  | "auth.signin.throttled"
  | "auth.unavailable"
  // A session refused because it was issued before the account's revocation
  // line. Worth a line of its own rather than folding into `access.denied`: it
  // is the only event here that somebody *asked for*, and an operator reading
  // a household's log should be able to tell "they revoked their sessions"
  // from "somebody was refused".
  | "auth.session.revoked"
  | "access.denied"
  | "request.throttled";

export interface SecurityDetails {
  /** The account the request was made by, when there was one. */
  userId?: string;
  /** The household the request was made against, when there was one. */
  householdId?: string;
  /** The client address, as the rate limiter identifies it. */
  address?: string;
  /** The tRPC path, for an access-control failure. */
  path?: string;
  /** The error code refused with. */
  code?: string;
  /**
   * Why, when the code alone does not say. `"not-found"` marks a household
   * lookup that missed: another household's id and an id nobody has are
   * refused alike, so the line cannot say which (`householdProcedure`).
   * `"cross-site"` marks a request the route handler refused before tRPC saw
   * it, which has no procedure to have thrown it.
   */
  reason?: string;
  /** The address a sign-in was attempted for. */
  email?: string;
  /** The `Sec-Fetch-Site` a browser declared, for a cross-site refusal. */
  fetchSite?: string;
}

/**
 * The keys that must never reach a line, whatever a caller passes.
 *
 * A belt-and-braces check rather than a type: `SecurityDetails` already has no
 * field for a password, but this function is the kind that grows a `context`
 * bag six months from now, and the failure would be silent and permanent —
 * every line written between the mistake and its discovery keeps the secret.
 */
const FORBIDDEN_KEYS = new Set([
  "password",
  "passwordhash",
  "hash",
  "token",
  "secret",
  "cookie",
  "session",
  "authorization",
  "credentials",
]);

/** Builds the line. Exported so a test can assert its shape without stdout. */
export function securityLine(
  event: SecurityEvent,
  details: SecurityDetails,
  now: Date,
): string {
  const safe: Record<string, string> = {};

  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null || value === "") continue;
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    safe[key] = String(value);
  }

  return JSON.stringify({ ts: now.toISOString(), event, ...safe });
}

/**
 * Writes one event.
 *
 * `console.warn` rather than `console.log` so these land on stderr and survive
 * a log configuration that drops informational output — a security log that
 * the operator's own log level can silence is not one.
 *
 * It cannot throw. A logger that takes down the request it was describing
 * turns an audit control into an availability bug, and the caller is usually
 * already in a `catch`.
 */
export function logSecurityEvent(
  event: SecurityEvent,
  details: SecurityDetails = {},
): void {
  try {
    console.warn(securityLine(event, details, new Date()));
  } catch {
    // Nothing useful to do here, and nothing worth failing a request over.
  }
}
