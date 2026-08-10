import { describe, it, expect, afterAll, beforeEach } from "bun:test";
import Redis from "ioredis";
import {
  RateLimitUnavailableError,
  closeRateLimiter,
  consumeRateLimit,
  resetRateLimit,
  type RateLimit,
} from "@/lib/rate-limit";

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
    const original = process.env.VALKEY_URL;
    await closeRateLimiter();
    // Port 1 is reserved and nothing listens on it.
    process.env.VALKEY_URL = "redis://127.0.0.1:1";

    try {
      let thrown: unknown;
      try {
        await consumeRateLimit(LIMIT, nextIdentifier());
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RateLimitUnavailableError);
    } finally {
      await closeRateLimiter();
      if (original === undefined) delete process.env.VALKEY_URL;
      else process.env.VALKEY_URL = original;
    }
  });
});
