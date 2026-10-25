import {
  describe,
  it,
  expect,
  afterAll,
  afterEach,
  beforeEach,
  spyOn,
} from "bun:test";
import Redis from "ioredis";
import { closeValkey } from "@/lib/valkey";
import {
  PRODUCT_CACHE_TTL_SECONDS,
  PRODUCT_MISS_TTL_SECONDS,
  valkeyProductCache,
} from "@/server/services/product-cache";
import { OpenFoodFactsClient } from "@/server/services/openFoodFacts";

/**
 * ISSUES.md DEBT-3 — the Open Food Facts cache, in Valkey rather than in one
 * replica's memory.
 *
 * Against a real Valkey, because sharing is the entire point: a `Map` works
 * perfectly on one process and fails silently on two, which is the shape of
 * defect a mock cannot show you.
 */

const inspector = new Redis(
  process.env.VALKEY_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  },
);

beforeEach(async () => {
  await valkeyProductCache.clear();
});

afterAll(async () => {
  await valkeyProductCache.clear();
  await inspector.quit();
  await closeValkey();
});

describe("what it keeps", () => {
  it("survives the process that wrote it", async () => {
    // The claim DEBT-3 is about. Written through the application's cache, read
    // back through a connection that knows nothing about it — which is what a
    // second replica is.
    await valkeyProductCache.set("8480000123456", '{"code":"8480000123456"}');

    expect(await inspector.get("off:product:v2:8480000123456")).toBe(
      '{"code":"8480000123456"}',
    );
  });

  it("expires rather than living for ever", async () => {
    // Thirty days: product records change rarely, but "rarely" is not "never",
    // and a cache with no expiry is a cache that is wrong for ever after the
    // first upstream correction.
    await valkeyProductCache.set("8480000123456", "{}");

    const ttl = await inspector.ttl("off:product:v2:8480000123456");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(PRODUCT_CACHE_TTL_SECONDS);
  });

  it("clears only its own keys", async () => {
    // It shares Valkey with the rate limiter. Clearing the product cache must
    // not drop somebody's sign-in counter, which is what a `FLUSHDB` — or a
    // careless `KEYS *` — would do.
    await inspector.set("rl:login:10.0.0.7", "3");
    await valkeyProductCache.set("8480000123456", "{}");

    await valkeyProductCache.setMissing("8480000999999");

    await valkeyProductCache.clear();

    expect(await inspector.get("off:product:v2:8480000123456")).toBeNull();
    // Misses too: a cleared cache that still answered "unknown" for a day
    // would not be cleared.
    expect(await inspector.exists("off:miss:v1:8480000999999")).toBe(0);
    expect(await inspector.get("rl:login:10.0.0.7")).toBe("3");

    await inspector.del("rl:login:10.0.0.7");
  });
});

describe("when Valkey is not there", () => {
  /**
   * The decision that separates this from the rate limiter.
   *
   * `rate-limit.ts` fails **closed**: an attempt it cannot count is refused,
   * because an uncounted attempt is an unlimited one. This fails **open**,
   * because the fallback for a cache it cannot reach is to ask Open Food Facts
   * — which is exactly what a cache miss already means. Refusing would break
   * barcode scanning to protect a performance optimisation.
   */
  it("reads as a miss instead of throwing", async () => {
    const original = process.env.VALKEY_URL;
    await closeValkey();
    // Port 1 is reserved and nothing listens on it.
    process.env.VALKEY_URL = "redis://127.0.0.1:1";

    try {
      expect(await valkeyProductCache.get("8480000123456")).toBeNull();
      // And a write is a no-op rather than an error the caller has to catch.
      await valkeyProductCache.set("8480000123456", "{}");
    } finally {
      await closeValkey();
      if (original === undefined) delete process.env.VALKEY_URL;
      else process.env.VALKEY_URL = original;
    }
  });

  it("still lets a barcode be looked up", async () => {
    // The assertion that matters to a person holding a tin: scanning works with
    // the cache down, just without the saving.
    const original = process.env.VALKEY_URL;
    const realFetch = globalThis.fetch;
    await closeValkey();
    process.env.VALKEY_URL = "redis://127.0.0.1:1";

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          code: "8480000123456",
          product: { code: "8480000123456", product_name: "Leche entera" },
          status: 1,
          status_verbose: "product found",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    try {
      const product = await new OpenFoodFactsClient().getProductByBarcode(
        "8480000123456",
      );

      expect(product?.product_name).toBe("Leche entera");
    } finally {
      globalThis.fetch = realFetch;
      await closeValkey();
      if (original === undefined) delete process.env.VALKEY_URL;
      else process.env.VALKEY_URL = original;
    }
  });
});

describe("what it refuses to hand back", () => {
  it("discards an entry it cannot parse", async () => {
    // The cache is shared and outlives a deploy, so an entry written by an
    // older shape of the schema is a real possibility. Trusting it would hand a
    // caller a "product" with fields missing; this refetches instead.
    await inspector.set("off:product:v2:8480000123456", '{"nonsense":true}');

    const realFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response(
        JSON.stringify({
          code: "8480000123456",
          product: { code: "8480000123456", product_name: "Leche entera" },
          status: 1,
          status_verbose: "product found",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      const product = await new OpenFoodFactsClient().getProductByBarcode(
        "8480000123456",
      );

      expect(fetched).toBe(true);
      expect(product?.product_name).toBe("Leche entera");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("a barcode Open Food Facts does not know", () => {
  /**
   * Remembered for a day, so the same unknown code is not fetched again and
   * again from this instance's one address — but only the definitive answer.
   * A failure is "unavailable", not "unknown", and stays asked again:
   * `resolveScan` relies on a retry after an outage being free to succeed.
   */
  const unknown = "9990000000017";
  const realFetch = globalThis.fetch;
  let fetches: number;
  // The service logs every failed lookup.
  let quiet: ReturnType<typeof spyOn>;

  /** Every lookup answered with a fresh copy of the same response. */
  function upstream(answer: () => Response) {
    fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return answer();
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    quiet = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    quiet.mockRestore();
  });

  it("asks once, and a second replica takes the answer", async () => {
    // The live shape, measured 2026-10-12: the v2 API says "no such product"
    // with HTTP 404 and a `status: 0` body, not with a 200.
    upstream(
      () =>
        new Response(
          JSON.stringify({
            code: unknown,
            status: 0,
            status_verbose: "product not found",
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
    );

    expect(
      await new OpenFoodFactsClient().getProductByBarcode(unknown),
    ).toBeNull();
    expect(
      await new OpenFoodFactsClient().getProductByBarcode(unknown),
    ).toBeNull();

    expect(fetches).toBe(1);
    // For a day, and only as a miss — never as a product.
    const ttl = await inspector.ttl(`off:miss:v1:${unknown}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(PRODUCT_MISS_TTL_SECONDS);
    expect(await inspector.exists(`off:product:v2:${unknown}`)).toBe(0);
  });

  it("asks again once the barcode is cleared", async () => {
    upstream(
      () =>
        new Response(
          JSON.stringify({
            code: unknown,
            status: 0,
            status_verbose: "product not found",
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
    );
    const client = new OpenFoodFactsClient();

    await client.getProductByBarcode(unknown);
    await client.clearCache(unknown);
    await client.getProductByBarcode(unknown);

    expect(fetches).toBe(2);
  });

  it("asks again after Open Food Facts fails", async () => {
    upstream(() => new Response("Internal Server Error", { status: 500 }));
    const client = new OpenFoodFactsClient();

    await client.getProductByBarcode(unknown);
    await client.getProductByBarcode(unknown);

    expect(fetches).toBe(2);
    expect(await inspector.exists(`off:miss:v1:${unknown}`)).toBe(0);
  });

  it("asks again after a 404 that is not Open Food Facts' answer", async () => {
    // A proxy's or CDN's error page: the status says "not found", but nothing
    // in it is OFF saying it has no such product.
    upstream(
      () =>
        new Response("<html><body>Not Found</body></html>", {
          status: 404,
          headers: { "Content-Type": "text/html" },
        }),
    );
    const client = new OpenFoodFactsClient();

    await client.getProductByBarcode(unknown);
    await client.getProductByBarcode(unknown);

    expect(fetches).toBe(2);
    expect(await inspector.exists(`off:miss:v1:${unknown}`)).toBe(0);
  });
});
