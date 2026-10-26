import { createHmac } from "node:crypto";
import { configuredSecret } from "@/lib/auth/secret";

/**
 * The name a sign-in attempt is logged under, instead of the address it tried.
 *
 * `auth.signin.failed` and `auth.signin.throttled` used to carry `email` in
 * plain text — for every well-formed address anybody submitted, registered or
 * not: a member's typo, a neighbour's address, a whole credential-stuffing
 * list. Those are people the database has never heard of, kept for as long as
 * the container's output is, and in every paste of `docker compose logs` into
 * an issue (security review, 2026-10-12). D64 keys the sign-in counter in
 * Valkey on a hash for exactly this reason — so that nothing becomes "a list
 * of who has tried to sign in" — and the log was that list.
 *
 * **Keyed, not a plain hash.** `accountIdentifier` in `@/lib/rate-limit` is an
 * unkeyed SHA-256, and an email address is guessable: anyone holding a pasted
 * log and a list of likely addresses could confirm each one. An HMAC under
 * `STOKY_SECRET` cannot be checked without the secret, which the operator
 * has and a reader of the paste does not. The `stoky-log-account:` prefix
 * keeps this use of the key apart from any other: the HMAC is over a message
 * no other part of the application signs.
 *
 * **Stable, so it still correlates.** The same address gives the same tag on
 * one instance, so "is somebody working through one account" is still a
 * `jq` group-by, and an operator investigating a person computes that person's
 * tag (SECURITY.md, "Refusals are recorded") and greps for it. Normalised the
 * way `loginSchema` and `accountIdentifier` normalise — trimmed and lowercased
 * — so the tag does not depend on how the address was typed.
 *
 * Sixteen hex characters, 64 bits: far beyond colliding among the addresses one
 * household's instance will ever see, short enough to read and grep.
 *
 * **Rotating `STOKY_SECRET` changes every tag**, so lines written before a
 * rotation no longer match lines written after it. That is the price of a key
 * the operator already has to keep secret; rotation also signs everybody out,
 * so it is not something that happens quietly.
 */

/** Separates this HMAC from any other use of the same key. */
export const ACCOUNT_TAG_CONTEXT = "stoky-log-account:";

/** Hex characters kept from the digest. */
export const ACCOUNT_TAG_LENGTH = 16;

/**
 * `secret` defaults to `STOKY_SECRET` (`configuredSecret`), read at call time. Production refuses
 * to start without one (`@/lib/auth/secret`); in development and the suites it
 * may be unset, and the tag is then keyed with the empty string — still not
 * the address, just not a secret worth the name.
 */
export function accountTag(
  email: string,
  secret: string = configuredSecret() ?? "",
): string {
  const normalised = email.trim().toLowerCase();
  return createHmac("sha256", secret)
    .update(ACCOUNT_TAG_CONTEXT + normalised)
    .digest("hex")
    .slice(0, ACCOUNT_TAG_LENGTH);
}
