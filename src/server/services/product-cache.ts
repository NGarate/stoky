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
 * Valkey outage makes barcode lookups slower and nothing else. Refusing them
 * would break scanning to protect a performance optimisation.
 *
 * **A seam, not an import.** `getProductByBarcode` is exercised in the unit
 * tier, which `CLAUDE.md` defines as needing no database; a Valkey call
 * hardcoded here would drag the whole file into the integration tier or, worse,
 * leave a unit test quietly depending on a service being up.
 */

/** Thirty days. Product records change rarely and a stale name is not harmful. */
export const PRODUCT_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

const PREFIX = "off:product:";

export interface ProductCache {
  get(barcode: string): Promise<string | null>;
  set(barcode: string, value: string): Promise<void>;
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

  async delete(barcode) {
    try {
      await valkey().del(PREFIX + barcode);
    } catch {
      // Nothing depends on this having worked; the entry expires anyway.
    }
  },

  async clear() {
    try {
      // `SCAN`, not `KEYS`. `KEYS` blocks the server for the length of the
      // keyspace, and this shares Valkey with the rate limiter — whose whole
      // job is to answer during a login. Only this prefix, so clearing the
      // product cache cannot drop somebody's sign-in counter.
      const redis = valkey();
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(
          cursor,
          "MATCH",
          `${PREFIX}*`,
          "COUNT",
          100,
        );
        cursor = next;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== "0");
    } catch {
      // Same reasoning as `delete`.
    }
  },
};

/** An in-memory double, for the tier that must not touch a service. */
export function memoryProductCache(): ProductCache {
  const store = new Map<string, string>();

  return {
    get: async (barcode) => store.get(barcode) ?? null,
    set: async (barcode, value) => {
      store.set(barcode, value);
    },
    delete: async (barcode) => {
      store.delete(barcode);
    },
    clear: async () => {
      store.clear();
    },
  };
}
