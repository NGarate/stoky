import { createHash } from "node:crypto";
import Redis from "ioredis";

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
 * without saying so.
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
 * this is the expensive one: up to 10 MB decoded, re-encoded through Sharp,
 * written to a volume, then handed to Tesseract. One call is seconds of CPU
 * and a file on disk.
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

let client: Redis | null = null;

function getClient(): Redis {
  if (!client) {
    const url = process.env.VALKEY_URL ?? "redis://localhost:6379";
    client = new Redis(url, {
      // Fail fast rather than hang: a sign-in must not sit waiting on a cache
      // that is not coming back. `maxRetriesPerRequest` rejects the command
      // once the connection has been down for that many attempts, and
      // `commandTimeout` covers the case where the socket is open but nothing
      // answers.
      //
      // The offline queue is deliberately left on. Turning it off rejects any
      // command issued while the client is reconnecting, which is a normal
      // transient state — it failed a test here by refusing a sign-in that had
      // nothing wrong with it.
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 2000,
    });
    // ioredis emits `error` on an unreachable server, and an unhandled 'error'
    // event on an EventEmitter takes the process down.
    client.on("error", () => {});
  }
  return client;
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
  await getClient().ping();
}

/** Test seam: drops the cached connection so a suite can exit cleanly. */
export async function closeRateLimiter(): Promise<void> {
  if (client) {
    const closing = client;
    client = null;
    await closing.quit().catch(() => {});
  }
}

/**
 * Counts one attempt against `identifier` and says whether it is allowed.
 *
 * A fixed window, not a sliding one: `INCR`, then `EXPIRE` on the first hit of
 * a window. A sliding window is fairer at the boundary — 5 attempts at 14:59
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
    const redis = getClient();
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, limit.windowSeconds);
    }

    if (count > limit.attempts) {
      const ttl = await redis.ttl(key);
      return {
        allowed: false,
        remaining: 0,
        // A key with no expiry (-1) would otherwise refuse for ever. Treat it
        // as a full window: wrong by at most one window rather than for ever.
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
 * Called after a successful sign-in. The specification counts attempts rather
 * than failures, and taken literally that locks out a household that signs in
 * six times in a quarter of an hour — a phone, a tablet and a laptop is three
 * before anyone has mistyped anything. Clearing on success keeps the ceiling
 * exactly where the specification puts it for someone who cannot sign in,
 * which is the only case the limit is defending against.
 */
export async function resetRateLimit(
  limit: RateLimit,
  identifier: string,
): Promise<void> {
  try {
    await getClient().del(`${limit.prefix}:${identifier}`);
  } catch {
    // A counter that could not be cleared expires on its own within the
    // window. Failing the sign-in that just succeeded would be worse.
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
