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
 * **A success is an event too.** ASVS 5.0.0 **16.3.1** asks for every
 * authentication attempt, successful or not, and the factor it used. Without
 * the successes the failures cannot be read: twenty refused sign-ins on an
 * account followed by silence is a typo-prone member or a guesser who got
 * in, and only the line that says somebody *did* sign in, from where and how,
 * tells the two apart (`auth.signin.succeeded`).
 *
 * **One line of JSON per event, on stderr** (`console.warn`, below). Not a
 * file, not a table: the deployment is Docker, so stderr is already collected
 * and reachable with `docker compose logs` — and rotated only because the
 * release bundle sets a size cap on every service (Docker's default keeps
 * everything; SECURITY.md, "Refusals are recorded") — and JSON means `| jq
 * 'select(.event == "access.denied")'` works without anybody installing
 * anything. A log table in
 * Postgres would need migrations, retention and a way to read it when the
 * database is the thing that is wrong.
 *
 * **What is deliberately not in a line.** No password, no hash, no token, no
 * session cookie, and no request body — an audit log that quotes the input is
 * a second copy of the credential. No email address either: a sign-in is
 * logged under `account`, a keyed tag of the address it tried
 * (`@/lib/account-tag`), because most addresses a refused sign-in names are
 * not in the database at all — typos, neighbours, a stuffing list — and the
 * operator owns none of them. Client addresses and account ids are in, because
 * they are what makes a line actionable.
 *
 * **Every value is cut to `MAX_VALUE_LENGTH`.** Lines are written for
 * refused requests, from people nobody let in, and some values are theirs to
 * choose; without a bound, one refused request could put megabytes into the
 * log.
 */

/** The events worth a line. Kept as a closed union so greps stay reliable. */
export type SecurityEvent =
  | "auth.signin.failed"
  | "auth.signin.throttled"
  // A sign-in that got in — ASVS 5.0.0 16.3.1, which asks for successful
  // authentications as well as failed ones, and for the factor used:
  // `method`, with the `userId` it signed in as and the same `account` tag
  // and `address` a failure carries, so one jq filter follows a person from
  // their refusals to their way in.
  | "auth.signin.succeeded"
  // The password was right and the account asks for a second step (D148):
  // not a sign-in yet, so not `succeeded`, and not a failure either. The
  // same `account` tag and `address`; the sign-in, if it completes, is the
  // `succeeded` line that follows with `method: "totp"` or `"backup-code"`.
  | "auth.signin.challenged"
  // Two-step verification (D148), never with the code or the secret:
  // `enabled` when an enrolment's first code is accepted; `failed` when a
  // code is refused at the second step, with the refusal as `code`;
  // `replayed` when a right code is sent again for a step already used
  // (ASVS 5.0.0 6.5.1); `locked` when the account's wrong codes have locked
  // it for a while; `unreadable` when the stored secret no longer decrypts
  // because `STOKY_SECRET` changed — the person cannot get in with that
  // authenticator, and the operator is the one who can tell them why.
  | "auth.twofactor.enabled"
  | "auth.twofactor.failed"
  | "auth.twofactor.replayed"
  | "auth.twofactor.locked"
  | "auth.twofactor.unreadable"
  | "auth.unavailable"
  // Sessions somebody ended on purpose, with the `reason`: the account's own
  // holder ending all of theirs (`self`), a password change ending every
  // other one (`password-change`), an admin ending a member's
  // (`admin`), an admin removing a member from the household (`removed`),
  // an owner ending every session in the household (`owner`, with no
  // `targetUserId`: they were everybody's),
  // a sign-in ending the session its browser presented
  // (`replaced`), or a sign-in that would be the account's eleventh session
  // ending its least recently used one (`evicted`; both in
  // `src/lib/auth/sign-in-tidy.ts`). `userId` did it,
  // `targetUserId` is whose they were, `count` is how many rows went. Worth a
  // line of its own rather than folding into `access.denied`: it is the only
  // event here that somebody *asked for*, and an operator reading a
  // household's log should be able to tell "they ended their sessions" from
  // "somebody was refused". A session that simply runs out writes nothing; its
  // row is deleted when next read, or at its account's next sign-in.
  | "auth.session.ended"
  // A signed-in person changed their own password. The credential change
  // ASVS V7 asks to be able to reconstruct — "who changed it, and when" —
  // with no password in it. The sessions it ended are their own
  // `auth.session.ended` line, `reason: "password-change"` (D144); a wrong
  // current password is `auth.reauth.refused`, `via: "password-change"`.
  | "auth.password.changed"
  // An admin set a new password for somebody else in the household, which
  // also ended every session that person had. `userId` is the admin who did
  // it and `targetUserId` the account it was done to: the line that answers
  // "who set my password?" when the answer is not "you".
  | "auth.password.reset"
  // The current password re-entered to confirm an action was wrong
  // (`src/lib/auth/reauth.ts`). `via` names the action — `end-sessions`,
  // `password-change`, `household-end-all` — so a grep tells a typo before
  // ending a session from a stolen session guessing. BAD_REQUEST, which the
  // refusal middleware in `trpc.ts` does not record, so written here.
  | "auth.reauth.refused"
  | "access.denied"
  | "request.throttled";

/**
 * How a sign-in proved who it was: the factor `auth.signin.succeeded` names.
 * A closed list for the same reason the events are one: a grep for
 * `"method":"passkey"` has to find every passkey sign-in.
 */
export type SignInMethod = "password" | "totp" | "backup-code" | "passkey";

export interface SecurityDetails {
  /** The account the request was made by, when there was one. */
  userId?: string;
  /** The household the request was made against, when there was one. */
  householdId?: string;
  /** The client address in full (`clientAddress`), not the /64 a limit counts. */
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
   * it, which has no procedure to have thrown it. On `auth.session.ended` it
   * is why: `"self"`, `"password-change"`, `"admin"`, `"removed"`,
   * `"owner"`, `"replaced"` or `"evicted"`.
   */
  reason?: string;
  /** The `Sec-Fetch-Site` a browser declared, for a cross-site refusal. */
  fetchSite?: string;
  /**
   * The account a sign-in was attempted for, as `accountTag(email)` — never
   * the address itself, which `FORBIDDEN_KEYS` drops.
   */
  account?: string;
  /** The account an action was done *to*, when that is not `userId`. */
  targetUserId?: string;
  /** The factor a successful sign-in used (`auth.signin.succeeded`). */
  method?: SignInMethod;
  /** How many things an action affected: sessions, for `auth.session.ended`. */
  count?: number;
  /** The action a re-entered password was to confirm (`auth.reauth.refused`). */
  via?: string;
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
  // Not a credential, but personal data about people who are mostly not
  // users here. `account` carries the tag instead; see `@/lib/account-tag`.
  "email",
]);

/**
 * The longest a value may be. Comfortably above anything legitimate — a tRPC
 * path, a UUID, an IPv6 address, a 16-character tag — and short enough that a
 * line stays a line.
 */
export const MAX_VALUE_LENGTH = 200;

/** Builds the line. Exported so a test can assert its shape without stderr. */
export function securityLine(
  event: SecurityEvent,
  details: SecurityDetails,
  now: Date,
): string {
  const safe: Record<string, string> = {};

  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null || value === "") continue;
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    safe[key] = String(value).slice(0, MAX_VALUE_LENGTH);
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
