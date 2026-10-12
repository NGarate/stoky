import { valkey } from "@/lib/valkey";

/**
 * Where an Open Food Facts lookup is remembered — ISSUES.md DEBT-3.
 *
 * It was a module-level `Map`, with a comment saying "in-memory cache for
 * development (should use Valkey/Redis in production)". The production compose
 * file can run more than one app container, so each replica kept its own copy:
 * the same barcode was fetched once per replica, cleared on every deploy, and
 * two people scanning the same tin got different answers if the record had been
 * edited upstream in between.
 *
 * **It fails open, which is the opposite of the rate limiter and deliberate.**
 * `rate-limit.ts` refuses what it cannot count, because an uncounted attempt is
 * an unlimited one. Here the fallback for a cache that cannot be reached is to
 * ask Open Food Facts, which is exactly what a cache miss already means — so a
 * Valkey outage costs this cache nothing but speed. Refusing a lookup because
 * the cache is down would break scanning to protect a performance optimisation.
 *
 * What a Valkey outage does to the *lookup* is decided elsewhere: the router
 * meters each request that reaches Open Food Facts, and a request it cannot
 * count is not sent (`meterLookup` in `routers/product.ts`), so with Valkey
 * down an uncached barcode lands on the manual form, as in an OFF outage.
 *
 * **A seam, not an import.** `getProductByBarcode` is exercised in the unit
 * tier, which `CLAUDE.md` defines as needing no database; a Valkey call
 * hardcoded here would drag the whole file into the integration tier or, worse,
 * leave a unit test quietly depending on a service being up.
 */

/** Thirty days. Product records change rarely and a stale name is not harmful. */
export const PRODUCT_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

// `v2`: the version is the shape of what is cached. v1 entries were written
// before the rating fields existed, parse cleanly — everything is optional —
// and would present a product as "no information" for up to thirty days after
// deploy. Bumping the prefix makes them misses; the stale keys expire on their
// own TTL.
const PREFIX = "off:product:v2:";

/**
 * One day, for a barcode Open Food Facts said it has no record of.
 *
 * Without it every scan of a code OFF does not know — a shop's own label, a
 * product nobody has described yet — went back to OFF, from this instance's
 * one address, as often as anyone pressed the button. A day rather than a
 * month because the answer is the one most likely to change: somebody adds the
 * product upstream, and the cost of remembering too long is a person typing in
 * a name OFF has since learned.
 */
export const PRODUCT_MISS_TTL_SECONDS = 24 * 60 * 60;

// Its own prefix, not a sentinel value under `PREFIX`: a miss read back by
// code that only knows hits would parse as a product, and a separate key lets
// a miss carry its own, shorter expiry.
const MISS_PREFIX = "off:miss:v1:";

export interface ProductCache {
  get(barcode: string): Promise<string | null>;
  set(barcode: string, value: string): Promise<void>;
  /**
   * Whether Open Food Facts answered "no such product" for this barcode
   * within the last `PRODUCT_MISS_TTL_SECONDS`.
   */
  isMissing(barcode: string): Promise<boolean>;
  /**
   * Remember that answer. Only for the definitive one: a timeout, an error
   * status or an answer that does not parse means "unavailable", and must
   * stay asked again.
   */
  setMissing(barcode: string): Promise<void>;
  /** Forget both what the barcode is and that it was unknown. */
  delete(barcode: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The real one.
 *
 * Every method swallows its own failure. A cache that throws is worse than no
 * cache at all: the caller would have to wrap each call, and the one that
 * forgets turns a Valkey blip into a failed scan.
 */
export const valkeyProductCache: ProductCache = {
  async get(barcode) {
    try {
      return await valkey().get(PREFIX + barcode);
    } catch {
      return null;
    }
  },

  async set(barcode, value) {
    try {
      // `EX` rather than a stored timestamp: Valkey expires the key itself, so
      // there is no stale entry to step over and no clock to compare against.
      await valkey().set(PREFIX + barcode, value, "EX", PRODUCT_CACHE_TTL_SECONDS);
    } catch {
      // The next lookup fetches. That is the whole cost.
    }
  },

  async isMissing(barcode) {
    try {
      return (await valkey().exists(MISS_PREFIX + barcode)) === 1;
    } catch {
      // Unreachable reads as "not known to be missing", which asks OFF —
      // the same fail-open answer as `get`.
      return false;
    }
  },

  async setMissing(barcode) {
    try {
      await valkey().set(MISS_PREFIX + barcode, "1", "EX", PRODUCT_MISS_TTL_SECONDS);
    } catch {
      // The next lookup asks again, which is what happened before misses
      // were remembered at all.
    }
  },

  async delete(barcode) {
    try {
      await valkey().del(PREFIX + barcode, MISS_PREFIX + barcode);
    } catch {
      // Nothing depends on this having worked; the entry expires anyway.
    }
  },

  async clear() {
    try {
      // `SCAN`, not `KEYS`. `KEYS` blocks the server for the length of the
      // keyspace, and this shares Valkey with the rate limiter — whose whole
      // job is to answer during a login. Only these prefixes, so clearing the
      // product cache cannot drop somebody's sign-in counter.
      const redis = valkey();
      for (const prefix of [PREFIX, MISS_PREFIX]) {
        let cursor = "0";
        do {
          const [next, keys] = await redis.scan(
            cursor,
            "MATCH",
            `${prefix}*`,
            "COUNT",
            100,
          );
          cursor = next;
          if (keys.length > 0) await redis.del(...keys);
        } while (cursor !== "0");
      }
    } catch {
      // Same reasoning as `delete`.
    }
  },
};

/** An in-memory double, for the tier that must not touch a service. */
export function memoryProductCache(): ProductCache {
  const store = new Map<string, string>();
  const missing = new Set<string>();

  return {
    get: async (barcode) => store.get(barcode) ?? null,
    set: async (barcode, value) => {
      store.set(barcode, value);
    },
    isMissing: async (barcode) => missing.has(barcode),
    setMissing: async (barcode) => {
      missing.add(barcode);
    },
    delete: async (barcode) => {
      store.delete(barcode);
      missing.delete(barcode);
    },
    clear: async () => {
      store.clear();
      missing.clear();
    },
  };
}
