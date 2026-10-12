import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { OpenFoodFactsClient, openFoodFacts } from "@/server/services/openFoodFacts";
import { memoryProductCache, type ProductCache } from "@/server/services/product-cache";

describe("OpenFoodFacts Service", () => {
  let client: OpenFoodFactsClient;

  beforeEach(() => {
    // The in-memory double, not Valkey. DEBT-3 moved the real cache into
    // Valkey, and `CLAUDE.md` defines this tier as needing no database — a
    // client that reached for one here would either fail on a clean machine or,
    // worse, pass while quietly depending on a service being up.
    client = new OpenFoodFactsClient(memoryProductCache());
  });

  describe("extractUnit", () => {
    it("should extract unit from quantity string", () => {
      expect(client.extractUnit("500g")).toBe("g");
      expect(client.extractUnit("1.5L")).toBe("l");
      expect(client.extractUnit("250ml")).toBe("ml");
      expect(client.extractUnit("2kg")).toBe("kg");
    });

    it("should return 'unit' for undefined quantity", () => {
      expect(client.extractUnit(undefined)).toBe("unit");
    });

    it("should return 'unit' for quantity without unit", () => {
      expect(client.extractUnit("2")).toBe("unit");
      expect(client.extractUnit("500")).toBe("unit");
    });

    it("should handle various unit formats", () => {
      expect(client.extractUnit("33cl")).toBe("cl");
      expect(client.extractUnit("1 oz")).toBe("oz"); // a space no longer changes the answer
      expect(client.extractUnit("1000G")).toBe("g"); // lowercase
    });
  });

  describe("caching behavior", () => {
    const barcode = "8480000123456";

    function stubFetch() {
      const calls: string[] = [];
      const originalFetch = global.fetch;

      global.fetch = (async (url: string | URL) => {
        calls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            code: barcode,
            status: 1,
            status_verbose: "product found",
            product: {
              code: barcode,
              product_name: "Leche entera",
              brands: "Hacendado",
              quantity: "1L",
              // The rating's inputs ride the same fetch — Phase 6. Asserted
              // below to survive the round trip, because a field the schema
              // silently dropped would surface as "no information on this
              // product" for everything ever scanned.
              nutriscore_grade: "c",
              nova_group: 3,
              additives_n: 1,
              additives_tags: ["en:e322"],
              nutrient_levels: { fat: "high", sugars: "moderate" },
              labels_tags: ["en:organic"],
            },
          }),
        };
      }) as unknown as typeof fetch;

      return { calls, restore: () => { global.fetch = originalFetch; } };
    }

    it("carries the rating fields through the schema", async () => {
      // Every field §6's formula reads. One dropped by the Zod schema comes out
      // as undefined, and the rating honestly reports "no data" — a silent hole
      // no other test would see.
      const { restore } = stubFetch();
      try {
        const product = await client.getProductByBarcode(barcode);

        expect(product?.nutriscore_grade).toBe("c");
        expect(product?.nova_group).toBe(3);
        expect(product?.additives_tags).toEqual(["en:e322"]);
        expect(product?.nutrient_levels?.fat).toBe("high");
        expect(product?.labels_tags).toEqual(["en:organic"]);
      } finally {
        restore();
      }
    });

    it("asks Open Food Facts for them", async () => {
      // The schema passing them through means nothing if the request never
      // names them: OFF returns only the fields asked for.
      const { calls, restore } = stubFetch();
      try {
        await client.getProductByBarcode(barcode);

        for (const field of [
          "nutriscore_grade",
          "nova_group",
          "additives_tags",
          "nutrient_levels",
          "labels_tags",
        ]) {
          expect(calls[0]).toContain(field);
        }
      } finally {
        restore();
      }
    });

    it("serves a repeated barcode from cache instead of refetching", async () => {
      const { calls, restore } = stubFetch();
      try {
        const first = await client.getProductByBarcode(barcode);
        const second = await client.getProductByBarcode(barcode);

        expect(first).not.toBeNull();
        expect(second).toEqual(first);
        expect(calls).toHaveLength(1);
      } finally {
        restore();
      }
    });

    it("refetches after the barcode's cache entry is cleared", async () => {
      const { calls, restore } = stubFetch();
      try {
        await client.getProductByBarcode(barcode);
        await client.clearCache(barcode);
        await client.getProductByBarcode(barcode);

        expect(calls).toHaveLength(2);
      } finally {
        restore();
      }
    });

    it("refetches after the whole cache is cleared", async () => {
      const { calls, restore } = stubFetch();
      try {
        await client.getProductByBarcode(barcode);
        await client.clearAllCache();
        await client.getProductByBarcode(barcode);

        expect(calls).toHaveLength(2);
      } finally {
        restore();
      }
    });

    it("does not serve one barcode's entry for another", async () => {
      const { calls, restore } = stubFetch();
      try {
        await client.getProductByBarcode(barcode);
        await client.getProductByBarcode("8410000999999");

        expect(calls).toHaveLength(2);
      } finally {
        restore();
      }
    });
  });

  /**
   * `beforeFetch` — where the router's per-account meter
   * (`productLookupRateLimit`) is asked. It must be asked exactly when a
   * request is about to leave, and its refusal must reach the caller as a
   * refusal: everything inside the lookup's try turns into null, and a null is
   * "nobody knows this code".
   */
  describe("the meter before a request leaves", () => {
    const barcode = "8480000123456";

    function stubFetch() {
      const calls: string[] = [];
      const originalFetch = global.fetch;
      global.fetch = (async (url: string | URL) => {
        calls.push(String(url));
        return new Response(
          JSON.stringify({
            code: barcode,
            status: 1,
            status_verbose: "product found",
            product: { code: barcode, product_name: "Leche entera" },
          }),
          { status: 200 },
        );
      }) as typeof fetch;
      return { calls, restore: () => (global.fetch = originalFetch) };
    }

    function meter(answer: boolean | Error) {
      let asked = 0;
      return {
        beforeFetch: async () => {
          asked += 1;
          if (answer instanceof Error) throw answer;
          return answer;
        },
        asked: () => asked,
      };
    }

    it("is asked for a lookup that reaches Open Food Facts, and not for one the cache answers", async () => {
      const { calls, restore } = stubFetch();
      const { beforeFetch, asked } = meter(true);
      try {
        await client.getProductByBarcode(barcode, beforeFetch);
        const again = await client.getProductByBarcode(barcode, beforeFetch);

        expect(again?.product_name).toBe("Leche entera");
        expect(calls).toHaveLength(1);
        expect(asked()).toBe(1);
      } finally {
        restore();
      }
    });

    it("is not asked for a barcode already known to be unknown", async () => {
      const cache = memoryProductCache();
      await cache.setMissing(barcode);
      const { calls, restore } = stubFetch();
      const { beforeFetch, asked } = meter(true);
      try {
        expect(
          await new OpenFoodFactsClient(cache).getProductByBarcode(barcode, beforeFetch),
        ).toBeNull();
        expect(asked()).toBe(0);
        expect(calls).toHaveLength(0);
      } finally {
        restore();
      }
    });

    it("leaves the request unsent when it says no", async () => {
      const { calls, restore } = stubFetch();
      try {
        expect(
          await client.getProductByBarcode(barcode, meter(false).beforeFetch),
        ).toBeNull();
        expect(calls).toHaveLength(0);
      } finally {
        restore();
      }
    });

    it("hands its refusal to the caller rather than answering 'unknown'", async () => {
      // Swallowed into null, a throttled scan would send the person to name a
      // product Open Food Facts may well know, and a queued one would become a
      // review question instead of waiting.
      const { calls, restore } = stubFetch();
      const refusal = new Error("over budget");
      try {
        let thrown: unknown;
        try {
          await client.getProductByBarcode(barcode, meter(refusal).beforeFetch);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBe(refusal);
        expect(calls).toHaveLength(0);
      } finally {
        restore();
      }
    });
  });

  describe("deadline", () => {
    // A real fetch against a loopback server rather than a stubbed one: a stub
    // ignores whatever `signal` it is handed, so it could not tell a lookup
    // with a deadline from one without. Only the address is redirected; the
    // request, the abort and the body read are Bun's own.
    const barcode = "8480000654321";
    const deadlineMs = 100;
    let server: ReturnType<typeof Bun.serve>;
    let requests: number;
    let originalFetch: typeof fetch;
    // The service logs every failed lookup; a timeout's DOMException would
    // bury the run's output.
    let quiet: ReturnType<typeof spyOn>;

    beforeEach(() => {
      quiet = spyOn(console, "error").mockImplementation(() => {});
    });

    function serve(answer: () => Response | Promise<Response>) {
      requests = 0;
      server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch() {
          requests += 1;
          return answer();
        },
      });
      originalFetch = global.fetch;
      global.fetch = ((url: string | URL, init?: RequestInit) => {
        const { pathname, search } = new URL(String(url));
        return originalFetch(`http://127.0.0.1:${server.port}${pathname}${search}`, init);
      }) as typeof fetch;
    }

    afterEach(() => {
      quiet.mockRestore();
      global.fetch = originalFetch;
      // Drops the connections a lookup without a deadline would still hold.
      server.stop(true);
    });

    /** A cache that also counts what was written to it, hit or miss. */
    function countingCache(): { cache: ProductCache; writes: () => number } {
      const inner = memoryProductCache();
      let writes = 0;
      return {
        cache: {
          ...inner,
          set: async (key, value) => {
            writes += 1;
            await inner.set(key, value);
          },
          setMissing: async (key) => {
            writes += 1;
            await inner.setMissing(key);
          },
        },
        writes: () => writes,
      };
    }

    /**
     * The lookup, or "still waiting" if it has not settled well past the
     * deadline — so a missing deadline fails the test instead of hanging the
     * run behind a request that never ends.
     */
    async function lookUp(client: OpenFoodFactsClient) {
      let guard: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        client.getProductByBarcode(barcode),
        new Promise<"still waiting">((resolve) => {
          guard = setTimeout(() => resolve("still waiting"), deadlineMs * 20);
        }),
      ]);
      clearTimeout(guard);
      return result;
    }

    it("gives up on Open Food Facts when it never answers", async () => {
      serve(() => new Promise<Response>(() => {}));
      const { cache, writes } = countingCache();
      const client = new OpenFoodFactsClient(cache, deadlineMs);

      const result = await lookUp(client);

      expect(result).toBeNull();
      expect(requests).toBe(1);
      expect(writes()).toBe(0);
    });

    it("gives up when the answer starts but never finishes", async () => {
      // Headers at once, then a body that stops mid-JSON: the deadline has
      // to cover reading the answer, not just receiving its first byte.
      serve(
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(`{"code":"${barcode}",`));
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
      );
      const client = new OpenFoodFactsClient(memoryProductCache(), deadlineMs);

      const result = await lookUp(client);

      expect(result).toBeNull();
    });

    it("asks again after a timeout instead of remembering it as unknown", async () => {
      // A timeout means "unavailable", not "no such product". Remembered as a
      // miss, one slow minute at Open Food Facts would hide a product it knows.
      serve(() => new Promise<Response>(() => {}));
      const client = new OpenFoodFactsClient(memoryProductCache(), deadlineMs);

      await lookUp(client);
      await lookUp(client);

      expect(requests).toBe(2);
    });
  });

  describe("singleton instance", () => {
    it("should export singleton instance", () => {
      expect(openFoodFacts).toBeDefined();
      expect(openFoodFacts).toBeInstanceOf(OpenFoodFactsClient);
    });
  });
});
