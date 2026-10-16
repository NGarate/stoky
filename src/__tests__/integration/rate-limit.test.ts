import { describe, it, expect, afterAll, beforeEach } from "bun:test";
import Redis from "ioredis";
import { TRPCError } from "@trpc/server";
import {
  RateLimitUnavailableError,
  accountIdentifier,
  closeRateLimiter,
  loginAccountRateLimit,
  loginDeviceRateLimit,
  loginRateLimit,
  consumeRateLimit,
  refundRateLimit,
  registerRateLimit,
  resetRateLimit,
  type RateLimit,
} from "@/lib/rate-limit";
import {
  KNOWN_DEVICE_CAP,
  KNOWN_DEVICE_TTL_SECONDS,
  isKnownDevice,
} from "@/lib/auth/known-devices";
import { enforceRateLimit, retryAfterSeconds } from "@/server/trpc/throttle";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { prisma } from "@/lib/prisma";
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

  it("gives a counter stranded without an expiry one on its next hit", async () => {
    // The state INCR-then-EXPIRE left behind when the EXPIRE was lost to a
    // timeout: a count past the limit and no TTL. The EXPIRE only ran when the
    // count was 1, so nothing ever repaired it and the address stayed refused
    // for ever. Built by hand here because a lost command is not a state a
    // test can produce on demand.
    const id = nextIdentifier();
    const key = `${LIMIT.prefix}:${id}`;
    await inspector.set(key, String(LIMIT.attempts + 5));
    expect(await inspector.ttl(key)).toBe(-1);

    const refused = await consumeRateLimit(LIMIT, id);
    expect(refused.allowed).toBe(false);

    const ttl = await inspector.ttl(key);
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

  it("refunds one attempt into the window that counted it", async () => {
    const id = nextIdentifier();
    const key = `${LIMIT.prefix}:${id}`;
    await consumeRateLimit(LIMIT, id);
    const { window } = await consumeRateLimit(LIMIT, id);

    await refundRateLimit(LIMIT, id, window);

    expect(await inspector.get(key)).toBe("1");
    // DECR keeps the TTL: the refund must not move the window's end.
    expect(await inspector.pexpiretime(key)).toBe(window);
  });

  it("does not refund into a later window than the one that counted it", async () => {
    // A sign-in counted just before its window ends can succeed just after,
    // when the key already holds a newer window full of somebody else's
    // guesses. Refunding there would erase one of them. The expiry is forced
    // here because waiting out a real window is not something a suite does.
    const id = nextIdentifier();
    const key = `${LIMIT.prefix}:${id}`;
    const { window: stale } = await consumeRateLimit(LIMIT, id);

    await inspector.pexpire(key, 1);
    while ((await inspector.exists(key)) === 1) await Bun.sleep(2);
    for (let i = 0; i < LIMIT.attempts; i++) await consumeRateLimit(LIMIT, id);

    await refundRateLimit(LIMIT, id, stale);

    expect(await inspector.get(key)).toBe(String(LIMIT.attempts));
    expect((await consumeRateLimit(LIMIT, id)).allowed).toBe(false);
  });

  it("does not resurrect a window that has already ended", async () => {
    // With no counter left, the refund is a no-op, not a SET to zero or
    // below: a negative count would be a budget larger than the limit.
    const id = nextIdentifier();
    const key = `${LIMIT.prefix}:${id}`;
    const { window } = await consumeRateLimit(LIMIT, id);
    await inspector.del(key);

    await refundRateLimit(LIMIT, id, window);

    expect(await inspector.exists(key)).toBe(0);
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
 * the auth route turns it into a 503 `AUTH_UNAVAILABLE`. Both are hand-written
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
    // The other call site, and the one that matters most: the auth route is
    // the application's only credential-verification path, so a `catch` that
    // let this through would be unlimited password guessing for as long as
    // Valkey is down.
    //
    // **Malformed credentials deliberately.** The route consults two limits —
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
    let answer: Awaited<ReturnType<typeof signInWith>> | undefined;

    await withUnreachableCache(async () => {
      answer = await signInWith({ email: "not an address", password: "" });
    });

    // Not RATE_LIMITED: the two produce different messages, and telling
    // somebody they have tried too often when the cache is down sends them
    // away to wait instead of to the operator. No Retry-After either: nothing
    // here knows when the cache comes back.
    expect(answer?.status).toBe(503);
    expect(answer?.code).toBe("AUTH_UNAVAILABLE");
    expect(answer?.retryAfter).toBeNull();
  });
});

/**
 * NIST SP 800-63B §5.2.2, through the only sign-in path the application has.
 *
 * Asserting this against `consumeRateLimit` with an account-shaped key would
 * prove nothing: it would pass just as well with the limit never wired into
 * the auth route at all. The property is that *sign-in* stops, so sign-in is what
 * this drives.
 */
describe("the per-account limit, through the auth route", () => {
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
      expect((await signInWith({ email, password: "wrong password here" })).status).toBe(401);
    }

    const refused = await signInWith({ email, password: "wrong password here" });

    // The account's own refusal, not the address's: the person is told the
    // account is being tried, because another network would not help them.
    expect(refused.status).toBe(429);
    expect(refused.code).toBe("ACCOUNT_RATE_LIMITED");
    expect(Number(refused.retryAfter)).toBeGreaterThan(0);
  });

  it("counts an address that does not exist, so it cannot be used to find one that does", async () => {
    // If only real accounts were counted, the difference between "refused for
    // rate limiting" and "rejected" would answer "is this address registered?"
    // — which is the enumeration oracle the flattened error messages exist to
    // close.
    const unknown = generateTestEmail("never-registered");

    for (let i = 0; i <= ATTEMPTS; i++) {
      // The refusal on the last iteration is the point.
      await signInWith({ email: unknown, password: "wrong password here" });
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
        expect((await signInWith({ email, password: "wrong password here" })).status).toBe(401);
      }

      // The last attempt of the budget, and it is correct.
      expect((await signInWith({ email, password })).status).toBe(200);

      // Which means the next one is not refused.
      expect((await signInWith({ email, password: "wrong password here" })).status).toBe(401);
    } finally {
      await cleanupTestUsers(email);
      await cleanupTestHouseholds(`Rate Limit Household ${process.pid}`);
    }
  });
});

/**
 * Known devices, through the auth route (security review, 2026-10-12).
 *
 * The per-account limit above refuses the right password once it is full, so
 * anyone who knows an address could spend it every window and keep its owner
 * out. A browser that has signed in to the account before is counted on a
 * budget of its own instead. What has to hold is both halves: the owner's
 * device gets in while a stranger has the shared budget full, and nothing a
 * stranger can send — no cookie, a minted one, one recorded for another
 * account — is treated as that device.
 */
describe("known devices, through the auth route", () => {
  const ACCOUNT_ATTEMPTS = 3;
  const DEVICE_ATTEMPTS = 2;
  const MARKER = `known-device-${process.pid}-${Date.now().toString(36)}`;
  const PASSWORD = "cocina despensa nevera";
  const WRONG = "wrong password here";
  const originalAccount = process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS;
  const originalDevice = process.env.RATE_LIMIT_LOGIN_DEVICE_ATTEMPTS;
  /** Every account this block signs in to, so cleanup touches only its own keys. */
  const accounts: string[] = [];

  beforeEach(() => {
    process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS = String(ACCOUNT_ATTEMPTS);
    process.env.RATE_LIMIT_LOGIN_DEVICE_ATTEMPTS = String(DEVICE_ATTEMPTS);
  });

  afterAll(async () => {
    if (originalAccount === undefined) delete process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS;
    else process.env.RATE_LIMIT_LOGIN_ACCOUNT_ATTEMPTS = originalAccount;
    if (originalDevice === undefined) delete process.env.RATE_LIMIT_LOGIN_DEVICE_ATTEMPTS;
    else process.env.RATE_LIMIT_LOGIN_DEVICE_ATTEMPTS = originalDevice;

    // Valkey is shared with whatever else is running against it, so only the
    // keys of this block's own accounts are removed.
    for (const email of accounts) {
      const account = accountIdentifier(email);
      const keys = [
        ...(await inspector.keys(`${loginDeviceRateLimit().prefix}:${account}:*`)),
        `${loginAccountRateLimit().prefix}:${account}`,
        `rl:known:${account}`,
      ];
      await inspector.del(...keys);
    }
    await cleanupTestUsers(MARKER);
    await cleanupTestHouseholds(MARKER);
  });

  async function member(label: string): Promise<string> {
    const email = generateTestEmail(`${MARKER}-${label}`);
    const household = await createTestHousehold({ name: `${MARKER} ${label}` });
    await createTestUser({
      email,
      name: generateTestName("Known"),
      password: PASSWORD,
      householdId: household.id,
    });
    accounts.push(email);
    return email;
  }

  /** A browser that has signed in to `email` once, successfully. */
  async function knownDevice(email: string): Promise<string> {
    const deviceId = crypto.randomUUID();
    expect((await signInWith({ email, password: PASSWORD }, { deviceId })).status).toBe(200);
    return deviceId;
  }

  /**
   * What the attacker does: spend the shared budget, a different address each
   * time, no cookie, until it refuses.
   */
  async function fillSharedBudget(email: string): Promise<void> {
    for (let i = 0; i < ACCOUNT_ATTEMPTS; i++) {
      expect((await signInWith({ email, password: WRONG })).status).toBe(401);
    }
    expect((await signInWith({ email, password: WRONG })).status).toBe(429);
  }

  it("lets a device recorded by an earlier sign-in in while a stranger holds the shared budget", async () => {
    const email = await member("owner");
    const phone = await knownDevice(email);

    await fillSharedBudget(email);

    expect((await signInWith({ email, password: PASSWORD }, { deviceId: phone })).status).toBe(200);
  });

  it("still refuses a browser with no device cookie once the shared budget is full", async () => {
    const email = await member("no-cookie");
    await knownDevice(email);

    await fillSharedBudget(email);

    expect((await signInWith({ email, password: PASSWORD })).status).toBe(429);
  });

  it("does not trust a freshly minted device id", async () => {
    // Anyone can send any well-formed `stoky_device`. If presence were enough,
    // a new UUID per guess would be a new budget per guess, and the limit that
    // bounds a distributed guess would be gone.
    const email = await member("minted");
    await knownDevice(email);

    await fillSharedBudget(email);

    expect((await signInWith({ email, password: PASSWORD }, { deviceId: crypto.randomUUID() })).status).toBe(429);
  });

  it("does not remember a device whose sign-in failed", async () => {
    // Only a success may record a device. Were a failure enough, a guesser
    // could mint a cookie, spend one wrong guess on it, and own a budget of
    // its own per cookie — the minted-id case above, one step later.
    const email = await member("failed");
    const guesser = crypto.randomUUID();

    expect((await signInWith({ email, password: WRONG }, { deviceId: guesser })).status).toBe(401);
    for (let i = 1; i < ACCOUNT_ATTEMPTS; i++) {
      expect((await signInWith({ email, password: WRONG })).status).toBe(401);
    }

    expect((await signInWith({ email, password: WRONG }, { deviceId: guesser })).status).toBe(429);
    expect(await inspector.exists(`rl:known:${accountIdentifier(email)}`)).toBe(0);
  });

  it("does not trust a device recorded for another account", async () => {
    // One shared kitchen tablet signs in to two people's accounts; being
    // known to one of them says nothing about the other.
    const victim = await member("victim");
    const other = await member("other");
    const tablet = await knownDevice(other);

    await fillSharedBudget(victim);

    expect((await signInWith({ email: victim, password: PASSWORD }, { deviceId: tablet })).status).toBe(429);
  });

  it("gives a known device a budget of its own that still runs out, without touching the shared one", async () => {
    // A stolen device cookie buys a few guesses a window, not an unlimited
    // number — and the guesses made on it are not the shared budget's.
    const email = await member("own-budget");
    const phone = await knownDevice(email);

    for (let i = 0; i < DEVICE_ATTEMPTS; i++) {
      expect((await signInWith({ email, password: WRONG }, { deviceId: phone })).status).toBe(401);
    }
    expect((await signInWith({ email, password: PASSWORD }, { deviceId: phone })).code).toBe("ACCOUNT_RATE_LIMITED");

    const shared = `${loginAccountRateLimit().prefix}:${accountIdentifier(email)}`;
    expect(await inspector.get(shared)).toBeNull();
    expect((await signInWith({ email, password: PASSWORD })).status).toBe(200);
  });

  it("leaves the shared budget as it found it when a known device signs in", async () => {
    // Clearing it would hand whoever is filling it a fresh budget every time
    // the owner signs in on their phone.
    const email = await member("leaves-shared");
    const phone = await knownDevice(email);

    for (let i = 0; i < ACCOUNT_ATTEMPTS - 1; i++) {
      expect((await signInWith({ email, password: WRONG })).status).toBe(401);
    }
    expect((await signInWith({ email, password: PASSWORD }, { deviceId: phone })).status).toBe(200);

    const shared = `${loginAccountRateLimit().prefix}:${accountIdentifier(email)}`;
    expect(await inspector.get(shared)).toBe(String(ACCOUNT_ATTEMPTS - 1));
  });

  it("keeps the twenty most recent devices and forgets the oldest", async () => {
    const email = await member("cap");
    const devices: string[] = [];
    for (let i = 0; i <= KNOWN_DEVICE_CAP; i++) devices.push(await knownDevice(email));

    const key = `rl:known:${accountIdentifier(email)}`;
    expect(await inspector.zcard(key)).toBe(KNOWN_DEVICE_CAP);
    expect(await inspector.ttl(key)).toBeGreaterThan(KNOWN_DEVICE_TTL_SECONDS - 60);

    await fillSharedBudget(email);

    // The first one recorded is the one pushed out, so it is a stranger again…
    expect((await signInWith({ email, password: PASSWORD }, { deviceId: devices[0] })).status).toBe(429);
    // …and the newest is still known.
    expect((await signInWith({ email, password: PASSWORD }, { deviceId: devices[KNOWN_DEVICE_CAP] })).status).toBe(200);
  });

  it("cannot be pre-empted by a forged address naming the device set", async () => {
    // Without a proxy the per-address identifier is whatever X-Forwarded-For
    // says. Were the set under the per-address prefix, this address's INCR
    // would plant a string at its key and every sign-in to the account would
    // then fail closed on WRONGTYPE.
    const email = await member("forged");
    const address = `known:${accountIdentifier(email)}`;
    const deviceId = crypto.randomUUID();

    expect((await signInWith({ email, password: WRONG }, { address })).status).toBe(401);
    expect((await signInWith({ email, password: PASSWORD }, { address, deviceId })).status).toBe(200);
    await fillSharedBudget(email);
    expect((await signInWith({ email, password: PASSWORD }, { deviceId })).status).toBe(200);
  });

  it("fails closed when it cannot ask whether a device is known", async () => {
    let thrown: unknown;
    await withUnreachableCache(async () => {
      try {
        await isKnownDevice(accountIdentifier("anyone@example.com"), crypto.randomUUID());
      } catch (error) {
        thrown = error;
      }
    });
    expect(thrown).toBeInstanceOf(RateLimitUnavailableError);
  });
});

/**
 * The per-address limit, through the auth route — and what a success does to it.
 *
 * A successful sign-in used to *clear* the address's counter. Anybody can sign
 * in successfully from an address: register an account of your own, and a few
 * guesses at other people's passwords followed by one good sign-in to yours
 * left the counter at zero, round after round. That is an unlimited password
 * spray from one address — the attack the per-address limit exists to stop.
 */
describe("the per-address limit, through the auth route", () => {
  const ATTEMPTS = 3;
  const original = process.env.RATE_LIMIT_LOGIN_ATTEMPTS;
  const MARKER = `spray-${process.pid}-${Date.now().toString(36)}`;
  const PASSWORD = "cocina despensa nevera";

  beforeEach(() => {
    process.env.RATE_LIMIT_LOGIN_ATTEMPTS = String(ATTEMPTS);
  });

  afterAll(async () => {
    if (original === undefined) delete process.env.RATE_LIMIT_LOGIN_ATTEMPTS;
    else process.env.RATE_LIMIT_LOGIN_ATTEMPTS = original;
    await cleanupTestUsers(MARKER);
    await cleanupTestHouseholds(MARKER);
  });

  async function ownAccount(label: string): Promise<string> {
    const email = generateTestEmail(`${MARKER}-${label}`);
    const household = await createTestHousehold({ name: `${MARKER} ${label}` });
    await createTestUser({
      email,
      name: generateTestName("Own"),
      password: PASSWORD,
      householdId: household.id,
    });
    return email;
  }

  it("does not let a good sign-in to one account wipe guesses at others", async () => {
    // Unique to this run: Valkey is shared, and a fixed address would inherit
    // whatever another run left in its bucket.
    const address = `203.0.113.7-${MARKER}`;
    const mine = await ownAccount("attacker");

    // Each round: guesses up to one short of the budget, each at a different
    // victim so no per-account limit fires and this is about the address
    // counter alone, then one good sign-in to the attacker's own account.
    let refused: string | undefined;
    rounds: for (let round = 0; round < 4; round++) {
      for (let guess = 0; guess < ATTEMPTS - 1; guess++) {
        const victim = generateTestEmail(`${MARKER}-victim-${round}-${guess}`);
        await signInWith({ email: victim, password: "wrong password here" }, { address });
      }
      const own = await signInWith({ email: mine, password: PASSWORD }, { address });
      if (own.status !== 200) {
        refused = own.code;
        break rounds;
      }
    }

    // The address's refusal, which says "this connection" — not the account's.
    expect(refused).toBe("RATE_LIMITED");
  });

  it("counts a body that is not JSON, before anything reads it", async () => {
    // The charge comes before the parse: a limit that counted only bodies it
    // could read would let anyone probe for free by sending ones it cannot.
    const address = `203.0.113.9-${MARKER}`;
    const key = `${loginRateLimit().prefix}:${address}`;

    const answer = await signInWith(
      { email: "", password: "" },
      { address, rawBody: '{"email": "ana@example.com", "password": ' },
    );

    expect(answer.status).toBe(400);
    expect(answer.code).toBe("INVALID_REQUEST");
    expect(await inspector.get(key)).toBe("1");
  });

  it("still does not charge a household for signing in successfully", async () => {
    // What clearing was for, kept: a phone, a tablet and a laptop behind one
    // NAT, signing in through the morning, spend nothing doing it.
    const address = `203.0.113.8-${MARKER}`;
    const mine = await ownAccount("household");

    for (let i = 0; i < ATTEMPTS + 2; i++) {
      expect((await signInWith({ email: mine, password: PASSWORD }, { address })).status).toBe(200);
    }
  });
});

/**
 * An IPv6 client, through the auth route: counted by its /64, logged in full.
 *
 * The unit suite pins the bucket `rateLimitIdentifier` computes. This pins
 * that sign-in counts on it and logs the other thing — one value used to do
 * both, so the grouping could be undone at the call site, or could erase the
 * address from the log, with every unit test still green.
 */
describe("an IPv6 client, through the auth route", () => {
  const ATTEMPTS = 3;
  const original = process.env.RATE_LIMIT_LOGIN_ATTEMPTS;
  // A /64 of the documentation prefix that is this run's alone: Valkey is
  // shared, and a fixed prefix would inherit whatever another run left in it.
  const PREFIX = `2001:db8:${(process.pid & 0xffff).toString(16)}:${(Date.now() & 0xffff).toString(16)}`;
  const NEIGHBOUR = `2001:db8:${(process.pid & 0xffff).toString(16)}:${((Date.now() + 1) & 0xffff).toString(16)}`;
  const realWarn = console.warn;

  beforeEach(async () => {
    process.env.RATE_LIMIT_LOGIN_ATTEMPTS = String(ATTEMPTS);
    await inspector.del(`rl:login:${PREFIX}::/64`, `rl:login:${NEIGHBOUR}::/64`);
  });

  afterAll(async () => {
    console.warn = realWarn;
    if (original === undefined) delete process.env.RATE_LIMIT_LOGIN_ATTEMPTS;
    else process.env.RATE_LIMIT_LOGIN_ATTEMPTS = original;
    await inspector.del(`rl:login:${PREFIX}::/64`, `rl:login:${NEIGHBOUR}::/64`);
  });

  // Malformed, so nothing is looked up and nothing is hashed: the per-address
  // limit counts an attempt before it reads one.
  const malformed = { email: "not an address", password: "" };

  it("refuses a client that rotates through its own /64", async () => {
    // A fresh address every attempt — what privacy extensions do on their own
    // and what an attacker does on purpose. Per address, none of these would
    // ever be refused.
    for (let host = 1; host <= ATTEMPTS; host++) {
      expect((await signInWith(malformed, { address: `${PREFIX}::${host}` })).status).toBe(400);
    }

    const refused = await signInWith(malformed, { address: `${PREFIX}:dead:beef:1234:5678` });
    expect(refused.status).toBe(429);
    expect(refused.code).toBe("RATE_LIMITED");

    // The next subscriber's /64 is somebody else, and keeps its own budget.
    expect((await signInWith(malformed, { address: `${NEIGHBOUR}::1` })).status).toBe(400);
  });

  it("writes the full address to the security log, not the /64", async () => {
    const lines: Record<string, string>[] = [];
    console.warn = (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === "string" && first.startsWith('{"ts":')) {
        lines.push(JSON.parse(first));
        return;
      }
      realWarn(...args);
    };

    try {
      await signInWith(malformed, { address: `${PREFIX}:dead:beef:1234:5678` });
    } finally {
      console.warn = realWarn;
    }

    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "auth.signin.failed",
        address: `${PREFIX}:dead:beef:1234:5678`,
      }),
    );
  });
});

/**
 * The registration limit, through the router that serves it
 * (`docs/SECURITY_REVIEW.md` finding 10).
 *
 * `CLAUDE.md` specifies 3 registrations per hour per IP, and until now the only
 * thing asserting that number was a unit test reading `registerRateLimit()`.
 * That test passes whether or not the limit is wired into anything: it would
 * have stayed green through the entire `enforceRateLimit` call being deleted
 * from `auth.register`. The property worth pinning is that *registering* stops,
 * so registering is what this drives — same reasoning as the sign-in block
 * above.
 *
 * Two attempts rather than the configured three, because each allowed one costs
 * a real Argon2id hash at 64 MB. The number under test is the environment's, and
 * the default is asserted separately in the unit suite.
 */
describe("the registration limit, through the router", () => {
  const ATTEMPTS = 2;
  const original = process.env.RATE_LIMIT_REGISTER_ATTEMPTS;
  /** Shared by every account this block creates, so cleanup is one call. */
  const PREFIX = `register-throttle-${process.pid}`;
  const PASSWORD = "cocina despensa nevera";

  beforeEach(async () => {
    process.env.RATE_LIMIT_REGISTER_ATTEMPTS = String(ATTEMPTS);
    const keys = await inspector.keys(`${registerRateLimit().prefix}:*`);
    if (keys.length > 0) await inspector.del(...keys);
  });

  afterAll(async () => {
    if (original === undefined) delete process.env.RATE_LIMIT_REGISTER_ATTEMPTS;
    else process.env.RATE_LIMIT_REGISTER_ATTEMPTS = original;
    await cleanupTestUsers(PREFIX);
  });

  /**
   * A caller carrying an address, which is the whole point: `auth.register`
   * meters only `if (ctx.headers)`, so a context without them — what the rest of
   * the integration suite builds — skips the limit entirely and would make this
   * block assert nothing.
   */
  async function callerFrom(address: string) {
    const ctx = await createTRPCContext({
      session: null,
      headers: new Headers({ "x-forwarded-for": address }),
    });
    return appRouter.createCaller(ctx);
  }

  const account = (suffix: string) => ({
    email: `${PREFIX}.${suffix}@example.com`,
    name: "Throttle Test",
    password: PASSWORD,
  });

  it("stops after the configured number from one address", async () => {
    const caller = await callerFrom(nextIdentifier());

    for (let i = 0; i < ATTEMPTS; i++) {
      const result = await caller.auth.register(account(String(i)));
      expect(result.success).toBe(true);
    }

    const over = account("over");
    let thrown: unknown;
    try {
      await caller.auth.register(over);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("TOO_MANY_REQUESTS");

    // Counted *before* anything is created, which is the half of the claim a
    // status code cannot make. If the limit ran after the write, the endpoint
    // would still be a way to fill the user table and to make the server spend
    // 250ms of Argon2id per call on demand.
    expect(await prisma.user.findUnique({ where: { email: over.email } })).toBeNull();
  });

  it("counts each address separately, so one abuser does not close the door", async () => {
    // A shared counter would mean anyone who spends the budget locks out every
    // other household trying to sign up that hour — a denial of service handed
    // out by the control meant to prevent one.
    const spender = await callerFrom(nextIdentifier());
    for (let i = 0; i < ATTEMPTS; i++) {
      await spender.auth.register(account(`spender-${i}`));
    }
    await expect(spender.auth.register(account("spender-over"))).rejects.toThrow();

    const bystander = await callerFrom(nextIdentifier());
    expect((await bystander.auth.register(account("bystander"))).success).toBe(true);
  });

  it("counts an IPv6 client by its /64, so rotating addresses buys nothing", async () => {
    // The sign-in block pins that the auth route counts on the /64; this pins the
    // other per-address limit. Register could count the raw address again
    // with every unit test still green.
    const prefix = `2001:db8:${(process.pid & 0xffff).toString(16)}:${(Date.now() & 0xffff).toString(16)}`;
    for (let host = 1; host <= ATTEMPTS; host++) {
      const caller = await callerFrom(`${prefix}::${host}`);
      expect((await caller.auth.register(account(`v6-${host}`))).success).toBe(true);
    }

    const rotated = await callerFrom(`${prefix}:dead:beef:1234:5678`);
    let thrown: unknown;
    try {
      await rotated.auth.register(account("v6-over"));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("TOO_MANY_REQUESTS");
  });
});
