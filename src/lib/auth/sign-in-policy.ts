import { accountTag } from "@/lib/account-tag";
import { logSecurityEvent, type SignInMethod } from "@/lib/security-log";
import { loginSchema } from "@/lib/validations/auth";
import {
  deviceFingerprint,
  deviceIdFromHeaders,
  isKnownDevice,
  rememberDevice,
} from "@/lib/auth/known-devices";
import {
  RateLimitUnavailableError,
  accountIdentifier,
  clientAddress,
  consumeRateLimit,
  loginAccountRateLimit,
  loginDeviceRateLimit,
  loginRateLimit,
  rateLimitIdentifier,
  refundRateLimit,
  resetRateLimit,
  type RateLimit,
} from "@/lib/rate-limit";

/**
 * What a sign-in costs, decided before anybody's password is looked at, and
 * what a success or a failure does to that cost afterwards.
 *
 * It takes `Headers` and an unparsed address and knows nothing about the
 * library that verifies the password. That is the point of it being here
 * rather than inside that library: the per-address, per-account and
 * known-device budgets are this application's policy, and the code that
 * enforces them did not have to move when next-auth was replaced by Better
 * Auth (PROGRESS D135). The auth route (`src/server/http/auth-handler.ts`)
 * charges and settles; Better Auth only checks the password.
 *
 * The order is the policy:
 *
 * 1. **The address is charged before the body is parsed.** A malformed body
 *    is still an attempt, and a limit that counted only well-formed ones
 *    would be a way to probe without spending anything.
 * 2. **The account, or this browser's own budget on it, is charged before
 *    Argon2id runs.** A limit that counts only attempts it has already spent
 *    ~250ms on is also a way to make the server do that work on demand.
 * 3. **A success refunds the address by exactly that one attempt and clears
 *    only the budget it was charged to** (`settleSignIn`).
 *
 * Valkey not answering at any step refuses the sign-in (`auth_unavailable`):
 * the limiter fails closed, for the reasons `src/lib/rate-limit.ts` gives.
 */

/** Why a sign-in was refused before its password was looked at. */
export type SignInRefusal = "rate_limited" | "account_rate_limited" | "auth_unavailable";

/**
 * A sign-in the policy refused.
 *
 * `code` is what the browser is told, and the three need three different
 * sentences (`src/lib/auth/error-messages.ts`): wait, your account is being
 * tried, the service is down. `retryAfterSeconds` is the limiter's own figure,
 * never below one so a `Retry-After` built from it never says "now"; for
 * `auth_unavailable` it is `null`, because nothing here can predict when the
 * cache comes back and inventing a number would send a client away to retry
 * on a schedule that means nothing.
 */
export class SignInRefusedError extends Error {
  readonly code: SignInRefusal;
  readonly retryAfterSeconds: number | null;

  constructor(code: SignInRefusal, retryAfterSeconds: number | null) {
    super(`Sign-in refused: ${code}`);
    this.name = "SignInRefusedError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * The counters and the known-device record, behind one seam so the policy can
 * be exercised without a cache. The default is Valkey, through the functions
 * the rest of the application uses; the integration suite proves those
 * against a real one.
 */
export interface SignInLimiter {
  consume: typeof consumeRateLimit;
  refund: typeof refundRateLimit;
  reset: typeof resetRateLimit;
  isKnownDevice: typeof isKnownDevice;
  rememberDevice: typeof rememberDevice;
}

export const valkeySignInLimiter: SignInLimiter = {
  consume: consumeRateLimit,
  refund: refundRateLimit,
  reset: resetRateLimit,
  isKnownDevice,
  rememberDevice,
};

/**
 * One attempt, charged and not yet settled. A plain object, so whatever
 * verifies the password can carry it from the charge to the outcome without
 * this module keeping any state of its own.
 */
export interface SignInCharge {
  outcome: "charged";
  /** The address as `emailSchema` stores it: trimmed and lowercased. */
  email: string;
  /** The client's address in full, for the security log. */
  address: string;
  /** The per-address budget as it was read when the attempt was counted. */
  addressLimit: RateLimit;
  /** What the per-address budget is counted against (an IPv6 /64, say). */
  addressIdentifier: string;
  /**
   * The window the per-address attempt landed in, captured at charge time.
   * `refundRateLimit` gives the attempt back to this window and no other, so
   * a success that lands after it ended cannot take one off the next.
   */
  addressWindow: number;
  /** The budget the account side was charged to: the shared one, or this device's. */
  charged: { kind: "device" | "account"; limit: RateLimit; identifier: string };
  /** The `stoky_device` id the request carried, when it carried a valid one. */
  deviceId: string | undefined;
  /** `accountIdentifier(email)`: what the account counter and device set are keyed on. */
  account: string;
  /** `accountTag(email)`: how the security log names the account. */
  accountTag: string;
}

/** An attempt whose address did not parse: counted per address, and nothing else. */
export interface MalformedSignIn {
  outcome: "malformed";
}

export type SignInAttempt = SignInCharge | MalformedSignIn;

const VALKEY_HINT =
  "[auth] sign-in refused: the rate limiter could not reach Valkey. Check VALKEY_URL and the cache service.";

/**
 * Turns the cache failing into a refusal, logged twice: the structured line
 * so the event is greppable alongside the other refusals, and the prose so an
 * operator reading the container output is told what to check rather than
 * left with a code.
 */
function unavailable(address: string, error: RateLimitUnavailableError): SignInRefusedError {
  logSecurityEvent("auth.unavailable", { address });
  console.error(VALKEY_HINT, error.cause);
  return new SignInRefusedError("auth_unavailable", null);
}

/** The limiter's figure, never below one second. */
function retryAfter(seconds: number): number {
  return Math.max(1, Math.ceil(seconds));
}

/** The per-address half of a charge: what every step of a sign-in costs. */
export interface AddressCharge {
  /** The client's address in full, for the security log. */
  address: string;
  addressLimit: RateLimit;
  addressIdentifier: string;
  /** The window the attempt landed in, so a refund goes back to it alone. */
  addressWindow: number;
}

/**
 * Counts one attempt against the client's address, and nothing else.
 *
 * The first step of every sign-in, and the whole charge of a second step
 * (D148) and of a passkey sign-in (D151): an authenticator code or a passkey
 * arrives with no address typed and no account named — only the challenge
 * cookie, or a credential id only Better Auth looks up — so there is no
 * account to count it against here. Better Auth counts wrong codes per
 * challenge and per account itself; a passkey cannot be guessed. Throws
 * `SignInRefusedError` as `chargeSignInAttempt` does.
 *
 * `addressLimit` is sign-in's own unless a step of a sign-in that is not an
 * attempt at a credential needs a budget of its own (the passkey ceremony's
 * options, `passkeyOptionsRateLimit`).
 */
export async function chargeSignInAddress(
  headers: Headers,
  limiter: SignInLimiter = valkeySignInLimiter,
  addressLimit: RateLimit = loginRateLimit(),
): Promise<AddressCharge> {
  // Counted against the /64 for an IPv6 client, logged with the address in
  // full: the bucket is what stops a client rotating through its own prefix,
  // and the address is what an operator needs to read.
  const addressIdentifier = rateLimitIdentifier(headers);
  const address = clientAddress(headers);

  try {
    const result = await limiter.consume(addressLimit, addressIdentifier);
    if (!result.allowed) {
      const seconds = retryAfter(result.retryAfterSeconds);
      logSecurityEvent("auth.signin.throttled", {
        address,
        code: `retry-after=${seconds}`,
      });
      throw new SignInRefusedError("rate_limited", seconds);
    }
    return { address, addressLimit, addressIdentifier, addressWindow: result.window };
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) throw unavailable(address, error);
    throw error;
  }
}

/**
 * Counts one sign-in attempt, before anything about it is believed.
 *
 * Throws `SignInRefusedError` when a budget is spent or the cache does not
 * answer. Returns `{ outcome: "malformed" }` for an address that does not
 * parse — already counted against the address, logged as a failure, and not
 * worth a password check. Otherwise returns the charge, which the caller
 * settles with `signInSucceeded` or `signInFailed`.
 */
export async function chargeSignInAttempt(
  headers: Headers,
  rawEmail: unknown,
  limiter: SignInLimiter = valkeySignInLimiter,
): Promise<SignInAttempt> {
  const { address, addressLimit, addressIdentifier, addressWindow } = await chargeSignInAddress(
    headers,
    limiter,
  );

  const parsed = loginSchema.shape.email.safeParse(rawEmail);
  if (!parsed.success) {
    logSecurityEvent("auth.signin.failed", { address, code: "malformed" });
    return { outcome: "malformed" };
  }
  const email = parsed.data;

  /**
   * The second limit, and the one NIST SP 800-63B §5.2.2 actually asks for:
   * consecutive failed attempts *on a single account*. The per-address limit
   * does not do that — a hundred addresses get five attempts each, five
   * hundred against one password. With both in force, they buy ten.
   *
   * Counted on the submitted address whether or not an account exists, so a
   * difference in behaviour cannot be used to learn which addresses are
   * registered.
   *
   * **Except from a browser this account has signed in from before.** A full
   * account counter refuses the right password too, so anyone who knows the
   * address could keep spending it and keep the member out (security review,
   * 2026-10-12). A known device is counted on a budget of its own instead —
   * the OWASP device-cookie pattern — and a stranger's guesses never touch
   * it. Whether the device is known is asked for registered and unregistered
   * addresses alike, and a device id nobody has recorded is counted on the
   * shared budget, so minting cookies buys nothing. See
   * `@/lib/auth/known-devices`.
   */
  const account = accountIdentifier(email);
  const tag = accountTag(email);
  const deviceId = deviceIdFromHeaders(headers);
  let charged: SignInCharge["charged"];

  try {
    charged =
      deviceId && (await limiter.isKnownDevice(account, deviceId))
        ? {
            kind: "device",
            limit: loginDeviceRateLimit(),
            identifier: `${account}:${deviceFingerprint(deviceId)}`,
          }
        : { kind: "account", limit: loginAccountRateLimit(), identifier: account };

    const result = await limiter.consume(charged.limit, charged.identifier);
    if (!result.allowed) {
      const seconds = retryAfter(result.retryAfterSeconds);
      logSecurityEvent("auth.signin.throttled", {
        address,
        account: tag,
        code: `${charged.kind} retry-after=${seconds}`,
      });
      throw new SignInRefusedError("account_rate_limited", seconds);
    }
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) throw unavailable(address, error);
    throw error;
  }

  return {
    outcome: "charged",
    email,
    address,
    addressLimit,
    addressIdentifier,
    addressWindow,
    charged,
    deviceId,
    account,
    accountTag: tag,
  };
}

/**
 * A charged attempt that did not get in: wrong password, no such account, or
 * a password that does not parse.
 *
 * One event, the same fields, for every one of them. The difference between
 * "no such account" and "wrong password" is exactly what the flattened error
 * refuses to tell the browser, and writing it into the log would put it back —
 * the log is readable by anyone who can read the container's output. The
 * attempt stays counted; that is what the charge was for.
 */
export function signInFailed(charge: SignInCharge): void {
  logSecurityEvent("auth.signin.failed", {
    address: charge.address,
    account: charge.accountTag,
  });
}

/**
 * Gives back what a successful attempt was charged, and no more.
 *
 * For the reason D30 gives: the specification counts attempts rather than
 * failures, and a household signing in from three devices is three attempts
 * before anybody has mistyped anything.
 *
 * **The two counters are not treated alike.** The budget the attempt was
 * charged to — the account's or this device's — is cleared: only its own
 * password gets here. Only that one: a known device signing in leaves the
 * shared counter as it found it, so the owner signing in on their phone does
 * not hand whoever is filling it a fresh budget. The address's counter is
 * refunded by this one attempt, because clearing it let anybody with an
 * account of their own wipe the failures beside it — four guesses at other
 * people's passwords, one good sign-in to their own, repeat. Refunded to the
 * window it was counted in (`SignInCharge.addressWindow`).
 */
export async function settleSignIn(
  charge: SignInCharge,
  limiter: SignInLimiter = valkeySignInLimiter,
): Promise<void> {
  await limiter.refund(charge.addressLimit, charge.addressIdentifier, charge.addressWindow);
  await limiter.reset(charge.charged.limit, charge.charged.identifier);
}

/**
 * The password was accepted: settle the charge, remember this browser for
 * the account — only now, which is what makes a recorded device worth a
 * budget of its own — and record that `userId` got in.
 *
 * The line is written last, once the cache has answered: if settling throws,
 * the sign-in does not complete, and a success line for a sign-in nobody
 * received would be the one false entry an audit log must not have. It
 * carries the tag and the address from the charge, never the address that
 * was typed (ASVS 5.0.0 16.3.1 for the event, `@/lib/account-tag` for why
 * the tag).
 */
export async function signInSucceeded(
  charge: SignInCharge,
  userId: string,
  method: SignInMethod = "password",
  limiter: SignInLimiter = valkeySignInLimiter,
): Promise<void> {
  await settleSignIn(charge, limiter);
  if (charge.deviceId) await limiter.rememberDevice(charge.account, charge.deviceId);
  logSecurityEvent("auth.signin.succeeded", {
    userId,
    method,
    account: charge.accountTag,
    address: charge.address,
  });
}

/**
 * The password was right and the account asks for a second step (D148).
 *
 * The charge is settled here, as for a sign-in — the budget it was charged to
 * cleared, the address refunded — because the password was the guess the
 * account budget exists to count, and it was not one. The second step is
 * counted on its own: per address by the route, per challenge and per
 * account by Better Auth. Not `rememberDevice`: a browser is a known device
 * for an account once it has got in, and it has not yet.
 */
export async function signInChallenged(
  charge: SignInCharge,
  limiter: SignInLimiter = valkeySignInLimiter,
): Promise<void> {
  await settleSignIn(charge, limiter);
  logSecurityEvent("auth.signin.challenged", {
    account: charge.accountTag,
    address: charge.address,
  });
}

/** Who a second step signed in, from Better Auth's answer. */
export interface SecondFactorSignIn {
  userId: string;
  /** The account's address, for its budget key and log tag; never logged itself. */
  email: string | undefined;
  /** The `stoky_device` id the request carried, when it carried a valid one. */
  deviceId: string | undefined;
}

/**
 * A sign-in charged to the address alone got in — an authenticator code or a
 * backup code finishing one (D148), or a passkey (D151): the address refunded
 * the attempt it was charged, this browser remembered for the account — now
 * it has got in — and the sign-in recorded with the factor that proved it.
 * Written last, as `signInSucceeded` is, so a line never describes a sign-in
 * that did not complete.
 */
export async function secondFactorSucceeded(
  charge: AddressCharge,
  { userId, email, deviceId }: SecondFactorSignIn,
  method: Exclude<SignInMethod, "password">,
  limiter: SignInLimiter = valkeySignInLimiter,
): Promise<void> {
  await limiter.refund(charge.addressLimit, charge.addressIdentifier, charge.addressWindow);
  if (email && deviceId) await limiter.rememberDevice(accountIdentifier(email), deviceId);
  logSecurityEvent("auth.signin.succeeded", {
    userId,
    method,
    account: email ? accountTag(email) : undefined,
    address: charge.address,
  });
}
