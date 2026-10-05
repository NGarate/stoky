import { createHash } from "node:crypto";
import { closeValkey, valkey } from "@/lib/valkey";

/**
 * Rate limiting — ISSUES.md CRITICAL-4, and OWASP ASVS V11.1.4 after it.
 *
 * `CLAUDE.md` specifies 5 login attempts per 15 minutes and 3 registrations
 * per hour, per IP. Until now there was neither an implementation nor a cache
 * client anywhere in `src/`, despite `cache` being a declared service in every
 * compose file since the beginning: a login form on the public internet with
 * unlimited password attempts.
 *
 * The counter lives in Valkey rather than in process memory because the
 * production compose file can run more than one app container, and a limiter
 * each replica keeps to itself multiplies the real limit by the replica count
 * without saying so. The connection itself is `@/lib/valkey` — it used to be
 * opened here, back when this was the only thing that needed one.
 *
 * It started as auth-only and is no longer: `uploadRateLimit` below meters
 * receipt upload, which is authenticated but expensive enough that an account
 * looping on it is its own denial of service. The counting machinery is the
 * same; what differs per limit is the number, the window, and what the counter
 * is keyed on.
 */

export interface RateLimit {
  /** How many attempts are allowed inside the window. */
  readonly attempts: number;
  /** The window, in seconds. */
  readonly windowSeconds: number;
  /** Key prefix, so two limits never share a counter. */
  readonly prefix: string;
}

/**
 * The limits, read from the environment on every call.
 *
 * They are configurable because the browser suite registers dozens of accounts
 * per run and would otherwise spend most of it locked out — and because a
 * self-hosted operator behind a single NAT may genuinely need a different
 * number. They are read per call rather than at import so a test can change
 * them without reloading the module.
 *
 * The defaults are the specification. `src/__tests__/unit/rate-limit.test.ts`
 * asserts them with the environment unset, so raising them in a test config
 * cannot quietly become the product's behaviour.
 */
function limitFromEnv(
  prefix: string,
  attemptsVar: string,
  windowVar: string,
  defaultAttempts: number,
  defaultWindowSeconds: number,
): RateLimit {
  const parse = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    prefix,
    attempts: parse(process.env[attemptsVar], defaultAttempts),
    windowSeconds: parse(process.env[windowVar], defaultWindowSeconds),
  };
}

export function loginRateLimit(): RateLimit {
  return limitFromEnv(
    "rl:login",
    "RATE_LIMIT_LOGIN_ATTEMPTS",
    "RATE_LIMIT_LOGIN_WINDOW_SECONDS",
    5,
    15 * 60,
  );
}

/**
 * Sign-in attempts against **one account**, however many addresses they come
 * from.
 *
 * NIST SP 800-63B §5.2.2 asks a verifier to limit consecutive failed attempts
 * *on a single account*, and the per-IP limit above does not do that: an
 * attacker with a hundred addresses gets five attempts from each, which is
 * five hundred against one password. This is the limit that makes a
 * distributed guess cost something.
 *
 * Ten rather than five, because a household legitimately signs in from several
 * addresses — a phone on mobile data, a laptop on the wifi, a tablet — and
 * this counter cannot tell them apart. With both limits in force, a hundred
 * addresses buy ten attempts per fifteen minutes, not five hundred.
 */
export function loginAccountRateLimit(): RateLimit {
  return limitFromEnv(
    "rl:login:acct",
    "RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS",
    "RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SECONDS",
    10,
    15 * 60,
  );
}

export function registerRateLimit(): RateLimit {
  return limitFromEnv(
    "rl:register",
    "RATE_LIMIT_REGISTER_ATTEMPTS",
    "RATE_LIMIT_REGISTER_WINDOW_SECONDS",
    3,
    60 * 60,
  );
}

/**
 * Receipt uploads, per account.
 *
 * OWASP ASVS V11.1.4 asks for anti-automation on expensive operations, and
 * this is the expensive one: up to 10 MB decoded, re-encoded through
 * `Bun.Image`, written to a volume, then handed to Tesseract. One call is
 * seconds of CPU and a file on disk.
 *
 * Thirty an hour is well past what a person does — a month of receipts caught
 * up in one sitting is under it, and a weekly shop is three — while capping an
 * account at a couple of minutes of OCR per hour instead of an afternoon of
 * it. See `src/server/trpc/throttle.ts` for why it counts accounts rather than
 * addresses.
 */
export function uploadRateLimit(): RateLimit {
  return limitFromEnv(
    "rl:upload",
    "RATE_LIMIT_UPLOAD_ATTEMPTS",
    "RATE_LIMIT_UPLOAD_WINDOW_SECONDS",
    30,
    60 * 60,
  );
}

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts left after this one. Zero once the limit is reached. */
  remaining: number;
  /** Seconds until the window resets. Meaningful only when refused. */
  retryAfterSeconds: number;
}

/**
 * Raised when the cache cannot be reached.
 *
 * The limiter fails **closed**: an attempt it cannot count is an attempt it
 * refuses. Failing open would mean an attacker who can take the cache down —
 * or an operator who mistypes `VALKEY_URL` — gets an auth endpoint with no
 * limit at all, which is the exact state this module exists to end.
 *
 * The cost is honest and worth naming: with Valkey down, nobody can sign in.
 * That is why this is a distinct error type rather than a generic failure —
 * the caller turns it into a message that says the service is unavailable, and
 * the server log names Valkey, so the operator is not left guessing at a login
 * form that rejects a correct password.
 */
export class RateLimitUnavailableError extends Error {
  constructor(cause: unknown) {
    super("The rate limiter could not reach the cache", { cause });
    this.name = "RateLimitUnavailableError";
  }
}

/**
 * Is the cache answering?
 *
 * Here rather than in the health route because the connection is here: a second
 * client opened for the health check would prove that *a* connection works
 * rather than that the one sign-in depends on does, and would hold a second
 * socket open for the life of the process.
 */
export async function pingCache(): Promise<void> {
  await valkey().ping();
}

/**
 * Test seam: drops the cached connection so a suite can exit cleanly.
 *
 * Kept as a name of its own rather than pointing callers at `closeValkey`
 * directly, because what a suite means by it is "let go of whatever the limiter
 * is holding" — and that is still true if the limiter ever holds something
 * else.
 */
export async function closeRateLimiter(): Promise<void> {
  await closeValkey();
}

/**
 * Counts one attempt and makes sure the window it lands in will end.
 *
 * **One script, not `INCR` then `EXPIRE`.** As two commands, a timeout or a
 * dropped connection between them — `commandTimeout` is 2s, and a blip is all
 * it takes — left a counter with no TTL. The `EXPIRE` only ran on the first hit
 * of a window, so nothing ever gave that key an expiry afterwards: one unlucky
 * sign-in locked its address, or its account, out for good, and only a manual
 * `DEL` on Valkey would let them back in. A script runs atomically, so the
 * counter and its expiry exist together or not at all.
 *
 * And it checks the TTL rather than the count, so a key already stranded
 * without one — by the old two-step code, or by anything else — is given a
 * window on its next hit instead of refusing for ever.
 *
 * Returns the count and the seconds left, so a refusal costs no second round
 * trip to ask.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/**
 * Counts one attempt against `identifier` and says whether it is allowed.
 *
 * A fixed window, not a sliding one: the first hit of a window starts its
 * expiry. A sliding window is fairer at the boundary — 5 attempts at 14:59
 * and 5 more at 15:01 both pass here — but it costs a sorted set per
 * identifier, and the boundary case still leaves an attacker at 10 attempts
 * per 15 minutes against Argon2id. That is not the attack this defends
 * against.
 */
export async function consumeRateLimit(
  limit: RateLimit,
  identifier: string,
): Promise<RateLimitResult> {
  const key = `${limit.prefix}:${identifier}`;

  try {
    const [count, ttl] = (await valkey().eval(
      CONSUME_SCRIPT,
      1,
      key,
      limit.windowSeconds,
    )) as [number, number];

    if (count > limit.attempts) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: ttl > 0 ? ttl : limit.windowSeconds,
      };
    }

    return {
      allowed: true,
      remaining: limit.attempts - count,
      retryAfterSeconds: 0,
    };
  } catch (error) {
    throw new RateLimitUnavailableError(error);
  }
}

/**
 * Clears the counter for `identifier`.
 *
 * Called after a successful sign-in, on the **per-account** counter only. The
 * specification counts attempts rather than failures, and taken literally that
 * locks out a household that signs in six times in a quarter of an hour — a
 * phone, a tablet and a laptop is three before anyone has mistyped anything.
 * Clearing on success keeps the ceiling exactly where the specification puts it
 * for someone who cannot sign in, which is the only case the limit is
 * defending against.
 *
 * Safe on the account counter because only the account's own password can
 * trigger it. **Not** safe on the per-address counter, which any account
 * signing in from that address could clear — see `refundRateLimit`.
 */
export async function resetRateLimit(
  limit: RateLimit,
  identifier: string,
): Promise<void> {
  try {
    await valkey().del(`${limit.prefix}:${identifier}`);
  } catch {
    // A counter that could not be cleared expires on its own within the
    // window. Failing the sign-in that just succeeded would be worse.
  }
}

/**
 * Gives back one attempt counted against `identifier`, and only one.
 *
 * What a successful sign-in does to the **per-address** counter. Clearing it
 * outright — which is what this used to do — handed the reset to whoever can
 * sign in from that address, and anybody can: register an account of your own,
 * then interleave four guesses against other people's accounts with one good
 * sign-in to yours, and the per-address limit never fills. One address, an
 * unlimited password spray, bounded only by the per-account limit of each
 * victim.
 *
 * Refunding the attempt that succeeded keeps what clearing was for — a
 * household behind one NAT signing in from a phone, a tablet and a laptop
 * spends nothing doing so — without letting a success erase the failures
 * beside it. Guesses stay counted whoever else signs in from the same place.
 *
 * In one script so the read and the decrement cannot interleave with another
 * request's `INCR`, and floored at zero so a counter that has already expired
 * is not driven negative into a budget larger than the limit. `DECR` keeps the
 * key's TTL, so the window still ends when it was going to.
 */
const REFUND_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count > 0 then
  return redis.call('DECR', KEYS[1])
end
return 0
`;

export async function refundRateLimit(
  limit: RateLimit,
  identifier: string,
): Promise<void> {
  try {
    await valkey().eval(REFUND_SCRIPT, 1, `${limit.prefix}:${identifier}`);
  } catch {
    // The same reasoning as `resetRateLimit`: the attempt stays counted until
    // the window ends, which is safe, and failing the sign-in that just
    // succeeded would be worse.
  }
}

/**
 * The identifier a limit is counted against: the client's IP, from the proxy
 * headers a self-hosted deployment puts in front of the app.
 *
 * **The last entry of `X-Forwarded-For`, not the first.** The header is a list
 * each proxy appends to, so the leftmost entry is whatever the client sent —
 * and an attacker who sets a different value on every request turns a per-IP
 * limit into no limit at all. The rightmost entry is written by the proxy
 * closest to this app, which in this deployment is Traefik, and is the only
 * entry a client cannot forge.
 *
 * With no proxy header at all — reaching the app directly, which is how it
 * runs in development — every caller shares the `unknown` bucket. That is
 * deliberate and it is the safe direction: a shared bucket over-restricts, and
 * the alternative of treating an unidentifiable caller as unlimited is the
 * hole this module closes.
 */
export function rateLimitIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    if (hops.length > 0) {
      return hops[hops.length - 1];
    }
  }

  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;

  return "unknown";
}

/**
 * The identifier an account limit is counted against.
 *
 * **Hashed, not the address itself.** A counter keyed on the raw email turns
 * the cache into a list of which addresses have tried to sign in — readable by
 * anyone who can run `KEYS` on Valkey, which in a self-hosted deployment is
 * anyone on the Docker network. The count is the only thing this needs to
 * know, and a hash counts just as well.
 *
 * Normalised first, so `Noel@Example.com ` and `noel@example.com` are one
 * account rather than two buckets an attacker can alternate between.
 */
export function accountIdentifier(email: string): string {
  const normalised = email.trim().toLowerCase();
  return createHash("sha256").update(normalised).digest("hex").slice(0, 32);
}
