import { createHash } from "node:crypto";
import { DEVICE_ID_COOKIE, isDeviceId } from "@/lib/device";
import { RateLimitUnavailableError } from "@/lib/rate-limit";
import { valkey } from "@/lib/valkey";

/**
 * The browsers an account has signed in from, so they can be given a sign-in
 * budget of their own (security review, 2026-10-12; PROGRESS D124).
 *
 * **Why this exists.** The per-account limit counts every attempt on an
 * address before the password is looked at, and refuses even the right one
 * once it is full. That is what bounds a guess spread across many addresses —
 * and it is also a lever: anyone who knows a member's address can spend those
 * ten attempts at the start of every window, from two addresses, and the
 * member cannot sign in anywhere for as long as they keep doing it. OWASP's
 * "device cookies" pattern, and NIST SP 800-63B §5.2.2's "accept
 * authentication only from known devices" alternative, are the standard answer:
 * a browser that has signed in to this account before is counted on its own,
 * so a stranger filling the shared budget does not touch it.
 *
 * **The device is `stoky_device`, and it is trusted only because the server
 * remembers it.** The cookie itself is attacker-controlled — anyone can send
 * any v4 UUID (`@/lib/device` says so) — so a cookie that is merely present
 * buys nothing. Only an id recorded here *after a successful sign-in to this
 * account* earns the separate budget; any other id, or none, falls through to
 * the shared counter as before. Minting a fresh UUID per guess therefore gets
 * an attacker exactly what it got before this file existed. What the recorded
 * id amounts to is a bearer secret: 122 random bits, `httpOnly`, never shown
 * to a script — the same thing a signed token would be, with the signature
 * replaced by a lookup.
 *
 * **Stored hashed.** The id is also the key of the screen-choice row, so the
 * raw value in Valkey would be one more place a cookie worth replaying could be
 * read from. A hash answers "have we seen it?" just as well.
 */

/**
 * Not under `rl:login:`, on purpose. The per-address counter is
 * `rl:login:<identifier>`, and without a proxy in front of the app the
 * identifier is whatever `X-Forwarded-For` says (SECURITY.md). A known-device
 * set under that prefix could be pre-empted by a forged header: the per-address
 * `INCR` would create a *string* at the set's key, every later read of it would
 * fail with `WRONGTYPE`, and — failing closed — nobody could sign in to that
 * account at all. A prefix the per-address key cannot produce rules that out.
 */
const KNOWN_DEVICES_PREFIX = "rl:known";

/**
 * Twenty browsers per account, the most recently successful kept.
 *
 * A household account is a phone, a tablet, a laptop and the odd browser
 * reinstall, not twenty; the cap is there so the set cannot grow without
 * bound, not to be reached. A device pushed out is not locked out — it falls
 * back to the shared budget, which is where every device was before.
 */
export const KNOWN_DEVICE_CAP = 20;

/** A year, refreshed by every success: the same lifetime as the cookie. */
export const KNOWN_DEVICE_TTL_SECONDS = 365 * 24 * 60 * 60;

function knownDevicesKey(account: string): string {
  return `${KNOWN_DEVICES_PREFIX}:${account}`;
}

/** What is stored and counted for a device: never the cookie value itself. */
export function deviceFingerprint(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex").slice(0, 32);
}

/**
 * The `stoky_device` id these headers carry, if they carry a well-formed one.
 *
 * Read from the `Cookie` header of the request being decided rather than
 * through `cookies()` from `next/headers`: that request is the one the
 * sign-in policy is deciding, it is what the tests can construct, and it does
 * not tie the policy to a Next request scope. A malformed value is treated as
 * no device, the same way `@/lib/device` treats it.
 */
export function deviceIdFromHeaders(headers: Headers): string | undefined {
  const header = headers.get("cookie");
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== DEVICE_ID_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return isDeviceId(value) ? value : undefined;
  }
  return undefined;
}

/**
 * Has `account` been signed in to from this device before?
 *
 * Throws `RateLimitUnavailableError` when Valkey does not answer, so the
 * caller fails closed exactly as it does for the counters: a device whose
 * standing cannot be checked is not given a budget, and the sign-in is
 * refused rather than waved through on the shared one either.
 */
export async function isKnownDevice(
  account: string,
  deviceId: string,
): Promise<boolean> {
  try {
    const score = await valkey().zscore(
      knownDevicesKey(account),
      deviceFingerprint(deviceId),
    );
    return score !== null;
  } catch (error) {
    throw new RateLimitUnavailableError(error);
  }
}

/**
 * Records a device after a successful sign-in, keeping the newest twenty.
 *
 * Scored by time, so re-adding a device moves it to the front, and trimmed by
 * rank in the same script so the set never holds more than the cap even for a
 * moment another request could observe. The TTL is refreshed each time: an
 * account nobody signs in to for a year forgets its devices, as the browsers
 * themselves forget the cookie.
 *
 * **Never fails the sign-in.** It runs after the password has been accepted,
 * and the cost of not recording is only that this device is treated as new
 * next time — the safe direction, and the reason it swallows errors the way
 * `resetRateLimit` does.
 */
const REMEMBER_SCRIPT = `
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -(tonumber(ARGV[3]) + 1))
redis.call('EXPIRE', KEYS[1], ARGV[4])
return redis.call('ZCARD', KEYS[1])
`;

export async function rememberDevice(
  account: string,
  deviceId: string,
): Promise<void> {
  try {
    await valkey().eval(
      REMEMBER_SCRIPT,
      1,
      knownDevicesKey(account),
      Date.now(),
      deviceFingerprint(deviceId),
      KNOWN_DEVICE_CAP,
      KNOWN_DEVICE_TTL_SECONDS,
    );
  } catch {
    // See above: the device is simply not known next time.
  }
}
