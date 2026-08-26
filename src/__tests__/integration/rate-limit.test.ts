import { describe, it, expect, afterAll, beforeEach } from "bun:test";
import Redis from "ioredis";
import { TRPCError } from "@trpc/server";
import {
  RateLimitUnavailableError,
  accountIdentifier,
  closeRateLimiter,
  loginAccountRateLimit,
  consumeRateLimit,
  resetRateLimit,
  type RateLimit,
} from "@/lib/rate-limit";
import { AuthUnavailableSignin, RateLimitedSignin } from "@/lib/auth";
import { enforceRateLimit, retryAfterSeconds } from "@/server/trpc/throttle";
import { signInWith } from "../utils/authorize";
import {
  cleanupTestHouseholds,
  cleanupTestUsers,
  createTestHousehold,
  createTestUser,
  generateTestEmail,
  generateTestName,
} from "../utils/test-helpers";

/**
 * ISSUES.md CRITICAL-4, against a real Valkey.
 *
 * Counting is the whole feature, and it is done by Valkey rather than by this
 * code — INCR, EXPIRE, TTL. A mocked client would assert that the mock was
 * called, which is the shape of test this project deleted 352 of. So this runs
 * against the `cache` service the compose files have always defined.
 */

const LIMIT: RateLimit = {
  attempts: 3,
  windowSeconds: 60,
  prefix: "rl:test",
};

let counter = 0;
/** A fresh identifier per test, so one test cannot spend another's budget. */
const nextIdentifier = () => `10.0.0.${++counter}-${process.pid}`;

/**
 * Runs `body` with the limiter pointed at a cache that is not there.
 *
 * Port 1 is reserved and nothing listens on it, so the connection fails rather
 * than hanging. The `closeRateLimiter()` on both sides matters more than it
 * looks: the client is cached for the life of the process, so without dropping
 * it first the limiter keeps using the connection it already had and the test
 * proves nothing — and without dropping it after, every later test in the file
 * inherits the dead one.
 */
async function withUnreachableCache(body: () => Promise<void>): Promise<void> {
  const original = process.env.VALKEY_URL;
  await closeRateLimiter();
  process.env.VALKEY_URL = "redis://127.0.0.1:1";

  try {
    await body();
  } finally {
    await closeRateLimiter();
    if (original === undefined) delete process.env.VALKEY_URL;
    else process.env.VALKEY_URL = original;
  }
}

const inspector = new Redis(process.env.VALKEY_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
});

beforeEach(async () => {
  const keys = await inspector.keys(`${LIMIT.prefix}:*`);
  if (keys.length > 0) await inspector.del(...keys);
});

afterAll(async () => {
  const keys = await inspector.keys(`${LIMIT.prefix}:*`);
  if (keys.length > 0) await inspector.del(...keys);
  await inspector.quit();
  await closeRateLimiter();
});

describe("consumeRateLimit", () => {
  it("allows exactly the configured number of attempts, then refuses", async () => {
    const id = nextIdentifier();

    for (let attempt = 1; attempt <= LIMIT.attempts; attempt++) {
      const result = await consumeRateLimit(LIMIT, id);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT.attempts - attempt);
    }

    const refused = await consumeRateLimit(LIMIT, id);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
  });

  it("keeps refusing once the budget is spent", async () => {
    const id = nextIdentifier();
    for (let i = 0; i < LIMIT.attempts + 3; i++) await consumeRateLimit(LIMIT, id);

    const result = await consumeRateLimit(LIMIT, id);
    expect(result.allowed).toBe(false);
  });

  it("counts each address separately", async () => {
    const spender = nextIdentifier();
    const bystander = nextIdentifier();

    for (let i = 0; i <= LIMIT.attempts; i++) await consumeRateLimit(LIMIT, spender);

    expect((await consumeRateLimit(LIMIT, spender)).allowed).toBe(false);
    expect((await consumeRateLimit(LIMIT, bystander)).allowed).toBe(true);
  });

  it("gives the window an expiry, so a refusal is not permanent", async () => {
    // Without the EXPIRE, the counter would live for ever and the first five
    // wrong passwords in the life of a deployment would lock that address out
    // permanently. Asserting the TTL is how that goes noticed.
    const id = nextIdentifier();
    await consumeRateLimit(LIMIT, id);

    const ttl = await inspector.ttl(`${LIMIT.prefix}:${id}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(LIMIT.windowSeconds);
  });

  it("reports how long is left when it refuses", async () => {
    const id = nextIdentifier();
    for (let i = 0; i <= LIMIT.attempts; i++) await consumeRateLimit(LIMIT, id);

    const refused = await consumeRateLimit(LIMIT, id);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(LIMIT.windowSeconds);
  });

  it("gives the budget back on reset", async () => {
    // What a successful sign-in does, so a household signing in from three
    // devices is not locked out by a limit meant for someone guessing.
    const id = nextIdentifier();
    for (let i = 0; i <= LIMIT.attempts; i++) await consumeRateLimit(LIMIT, id);
    expect((await consumeRateLimit(LIMIT, id)).allowed).toBe(false);

    await resetRateLimit(LIMIT, id);

    expect((await consumeRateLimit(LIMIT, id)).allowed).toBe(true);
  });

  it("fails closed when the cache cannot be reached", async () => {
    // The decision this suite exists to pin. An attempt that cannot be counted
    // is refused: failing open would hand an unlimited auth endpoint to anyone
    // who can take Valkey down, which is the state CRITICAL-4 describes.
    let thrown: unknown;

    await withUnreachableCache(async () => {
      try {
        await consumeRateLimit(LIMIT, nextIdentifier());
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBeInstanceOf(RateLimitUnavailableError);
  });
});

/**
 * Fail-closed at the **call sites**, which is a different claim from the one
 * above (`docs/SECURITY_REVIEW.md` finding 11).
 *
 * `consumeRateLimit` throwing is necessary and not sufficient. What protects the
 * application is what each caller does with that throw, and every caller has to
 * decide separately: `enforceRateLimit` turns it into `SERVICE_UNAVAILABLE`, and
 * `authorize` turns it into `AuthUnavailableSignin`. Both are hand-written
 * `catch` blocks, and a `catch` that swallowed the error instead would leave
 * every test in this file green while the limit stopped existing.
 *
 * That is not a hypothetical regression, it is the tempting one: with Valkey
 * down nobody can sign in, and the obvious way to "fix" that outage is to let
 * the attempt through. These tests are what makes that a deliberate change
 * rather than a quiet one.
 */
describe("what a call site does when it cannot count", () => {
  it("refuses through enforceRateLimit rather than allowing the call", async () => {
    let thrown: unknown;

    await withUnreachableCache(async () => {
      try {
        await enforceRateLimit(LIMIT, nextIdentifier(), "never reached");
      } catch (error) {
        thrown = error;
      }
    });

    // `undefined` here is the fail-open regression: the helper returned
    // normally and the procedure behind it would have gone ahead.
    expect(thrown).toBeInstanceOf(TRPCError);
    const refusal = thrown as TRPCError;

    // Not `TOO_MANY_REQUESTS`, because the two mean different things to Phase
    // 4's write queue and to the person reading the message: one says you did
    // too much, the other says the service is broken.
    expect(refusal.code).toBe("SERVICE_UNAVAILABLE");

    // And it carries no `ThrottledError`, so no `Retry-After` is invented for a
    // cache whose return nothing here can predict. `throttle.ts` says that in
    // prose; this is what holds it to it.
    expect(retryAfterSeconds([refusal])).toBeNull();
  });

  it("refuses a sign-in it cannot count", async () => {
    // The other call site, and the one that matters most: `authorize` is the
    // application's only credential-verification path, so a `catch` that let
    // this through would be unlimited password guessing for as long as Valkey
    // is down.
    //
    // **Malformed credentials deliberately.** `authorize` consults two limits —
    // per address before parsing, per account after — and with the cache down
    // both throw. Written with a well-formed address this test passed with the
    // first `catch` block replaced by a fail-open, because the second one
    // refused instead and produced the same error. A body that fails
    // `loginSchema` returns before the account limit is reached, which is what
    // makes this about the first call site rather than about either.
    //
    // The second call site is left as defence in depth rather than covered
    // here: reaching it requires the address limit to have succeeded and the
    // account limit to then fail, which is a cache that died between two
    // commands, not a state this suite can produce.
    let thrown: unknown;

    await withUnreachableCache(async () => {
      try {
        await signInWith({ email: "not an address", password: "" });
      } catch (error) {
        thrown = error;
      }
    });

    // Not `RateLimitedSignin`: the two produce different messages, and telling
    // somebody they have tried too often when the cache is down sends them
    // away to wait instead of to the operator.
    expect(thrown).toBeInstanceOf(AuthUnavailableSignin);
  });
});

/**
 * NIST SP 800-63B §5.2.2, through the only sign-in path the application has.
 *
 * Asserting this against `consumeRateLimit` with an account-shaped key would
 * prove nothing: it would pass just as well with the limit never wired into
 * `authorize` at all. The property is that *sign-in* stops, so sign-in is what
 * this drives.
 */
describe("the per-account limit, through authorize", () => {
  const ATTEMPTS = 3;
  const original = process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS;

  beforeEach(async () => {
    process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS = String(ATTEMPTS);
    const keys = await inspector.keys(`${loginAccountRateLimit().prefix}:*`);
    if (keys.length > 0) await inspector.del(...keys);
  });

  afterAll(() => {
    if (original === undefined) delete process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS;
    else process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS = original;
  });

  it("stops a guess spread across a different address every time", async () => {
    // The per-IP limit alone does not do this: a hundred addresses buy a
    // hundred budgets against one password. `freshTestAddress()` per call is
    // what makes this test about the account counter rather than the IP one.
    const email = generateTestEmail("distributed");

    for (let i = 0; i < ATTEMPTS; i++) {
      // Wrong password, no such account — both irrelevant, because the count
      // happens before either is looked at.
      expect(await signInWith({ email, password: "wrong password here" })).toBeNull();
    }

    let thrown: unknown;
    try {
      await signInWith({ email, password: "wrong password here" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RateLimitedSignin);
  });

  it("counts an address that does not exist, so it cannot be used to find one that does", async () => {
    // If only real accounts were counted, the difference between "refused for
    // rate limiting" and "rejected" would answer "is this address registered?"
    // — which is the enumeration oracle the flattened error messages exist to
    // close.
    const unknown = generateTestEmail("never-registered");

    for (let i = 0; i <= ATTEMPTS; i++) {
      try {
        await signInWith({ email: unknown, password: "wrong password here" });
      } catch {
        // The refusal on the last iteration is the point.
      }
    }

    const key = `${loginAccountRateLimit().prefix}:${accountIdentifier(unknown)}`;
    expect(await inspector.get(key)).toBe(String(ATTEMPTS + 1));
  });

  it("gives a household its budget back when somebody actually signs in", async () => {
    // Otherwise a phone, a tablet and a laptop signing in through the morning
    // spend a limit that exists to stop someone guessing.
    const email = generateTestEmail("resets");
    const password = "cocina despensa nevera";
    const household = await createTestHousehold({ name: `Rate Limit Household ${process.pid}` });
    await createTestUser({ email, name: generateTestName("Resets"), password, householdId: household.id });

    try {
      for (let i = 0; i < ATTEMPTS - 1; i++) {
        expect(await signInWith({ email, password: "wrong password here" })).toBeNull();
      }

      // The last attempt of the budget, and it is correct.
      expect(await signInWith({ email, password })).not.toBeNull();

      // Which means the next one is not refused.
      expect(await signInWith({ email, password: "wrong password here" })).toBeNull();
    } finally {
      await cleanupTestUsers(email);
      await cleanupTestHouseholds(`Rate Limit Household ${process.pid}`);
    }
  });
});
