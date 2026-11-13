import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  OpenFoodFactsClient,
  openFoodFacts,
} from "@/server/services/openFoodFacts";
import {
  memoryProductCache,
  type ProductCache,
} from "@/server/services/product-cache";

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
    it("reads the measure, whatever its case", () => {
      for (const [quantity, unit] of [
        ["500g", "g"],
        ["1000G", "g"],
        ["2kg", "kg"],
        ["1.5KG", "kg"],
        ["1.5L", "l"],
        ["250ml", "ml"],
        ["250ML", "ml"],
        ["33cl", "cl"],
        ["75CL", "cl"],
        ["16oz", "oz"],
        ["1 oz", "oz"],
        ["2.2LB", "lb"],
      ]) {
        expect([quantity, client.extractUnit(quantity)]).toEqual([
          quantity,
          unit,
        ]);
      }
    });

    it("counts in units when there is no measure", () => {
      for (const quantity of [undefined, "", "2", "500", "1.5"]) {
        expect(client.extractUnit(quantity)).toBe("unit");
      }
    });

    it("answers the same with or without a space", () => {
      // "1 kg" was "g" while "1kg" was "kg", and "500 ml" was "l" while
      // "500ml" was "ml": two parsers that disagreed.
      for (const [compact, spaced, unit] of [
        ["1kg", "1 kg", "kg"],
        ["500g", "500 g", "g"],
        ["500ml", "500 ml", "ml"],
        ["33cl", "33 cl", "cl"],
        ["1,5l", "1,5 l", "l"],
      ]) {
        expect([
          client.extractUnit(compact),
          client.extractUnit(spaced),
        ]).toEqual([unit, unit]);
      }
    });

    it("reads unit words in Spanish and English", () => {
      // Was "s": every spaced word ending in "s" became the unit "s".
      expect(client.extractUnit("250 grams")).toBe("g");
      expect(client.extractUnit("250 gramos")).toBe("g");
      expect(client.extractUnit("1 kilo")).toBe("kg");
      expect(client.extractUnit("2 litros")).toBe("l");
      expect(client.extractUnit("750 mililitros")).toBe("ml");
    });

    it("counts in the app's count unit when the word is a thing, not a measure", () => {
      // "12 huevos" was a product counted in "s".
      expect(client.extractUnit("12 huevos")).toBe("unit");
      expect(client.extractUnit("6 unidades")).toBe("unit");
      expect(client.extractUnit("10 sobres")).toBe("unit");
      expect(client.extractUnit("4 piezas")).toBe("unit");
    });

    it("reads a multipack by what each one holds", () => {
      expect(client.extractUnit("6x33cl")).toBe("l");
      expect(client.extractUnit("pack 6x1L")).toBe("l");
    });
  });

  describe("what Open Food Facts answers", () => {
    const originalFetch = global.fetch;
    let calls: { url: string; init?: RequestInit }[];

    /** Every request answered by `answer`, a fresh Response each time. */
    function upstream(answer: () => Response | Promise<Response>) {
      calls = [];
      global.fetch = (async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return answer();
      }) as unknown as typeof fetch;
    }

    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    let quiet: ReturnType<typeof spyOn>;
    beforeEach(() => {
      // The service logs every failed lookup.
      quiet = spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      global.fetch = originalFetch;
      quiet.mockRestore();
    });

    it("reads the fields in the shapes the live API sends them", async () => {
      // `serving_quantity` as a number failed the whole parse, which this
      // service reports as "not found"; and the calorie count is under
      // `energy-kcal`, so a schema reading `energy_kcal` never filled it.
      upstream(() =>
        json({
          code: "8410000678901",
          product: {
            code: "8410000678901",
            product_name: "Leche entera",
            serving_quantity: 250,
            nutriments: {
              "energy-kcal": 63,
              "energy-kcal_100g": 63,
              proteins: 3.1,
            },
          },
          status: 1,
          status_verbose: "product found",
        }),
      );

      const result = await client.getProductByBarcode("8410000678901");
      expect(result?.serving_quantity).toBe("250");
      expect(result?.nutriments?.energy_kcal).toBe(63);
      expect(result?.nutriments?.proteins).toBe(3.1);

      // And the same once it has been cached and read back.
      const cached = await client.getProductByBarcode("8410000678901");
      expect(calls).toHaveLength(1);
      expect(cached?.nutriments?.energy_kcal).toBe(63);
    });

    it("treats an empty stub OFF calls 'found' as unknown, and does not keep it", async () => {
      // The live shape on 2026-10-05 for a code nobody has described: an app
      // scan made OFF create the record, so the API says "product found" with
      // `empty: 1` and no name. Taken as a hit, it became a product called
      // "Product 9990000000017" instead of a question for the person.
      upstream(() =>
        json({
          code: "9990000000017",
          product: {
            code: "9990000000017",
            empty: 1,
            completeness: 0,
            countries: "Ireland",
          },
          status: 1,
          status_verbose: "product found",
        }),
      );

      expect(await client.getProductByBarcode("9990000000017")).toBeNull();
      // Not cached: once someone names it upstream, the next lookup sees that.
      expect(await client.getProductByBarcode("9990000000017")).toBeNull();
      expect(calls).toHaveLength(2);
    });

    it("answers unknown for a body it cannot use", async () => {
      for (const body of [
        // "found", with no product in it
        { code: "1234567890123", status: 1, status_verbose: "product found" },
        // a status of the wrong type
        { code: "1234567890123", product: { code: "1" }, status: "success" },
      ]) {
        upstream(() => json(body));
        expect([
          body,
          await client.getProductByBarcode("1234567890123"),
        ]).toEqual([body, null]);
        await client.clearAllCache();
      }
      upstream(() => new Response("invalid json", { status: 200 }));
      expect(await client.getProductByBarcode("1234567890123")).toBeNull();
    });

    it("answers unknown when the request fails", async () => {
      upstream(() => Promise.reject(new Error("Network error")));

      expect(await client.getProductByBarcode("1234567890123")).toBeNull();
    });

    it("keeps a barcode inside the path segment it is put in", async () => {
      // The schema refuses anything but digits; this is the service not
      // relying on that. A raw `../` or `?` would otherwise change which
      // Open Food Facts URL this server requests.
      upstream(() =>
        json({ code: "x", status: 0, status_verbose: "not found" }),
      );

      await client.getProductByBarcode("../search?x=1");

      expect(calls[0]?.url).toContain("/product/..%2Fsearch%3Fx%3D1.json?");
    });

    it("names itself with the release it is and the project's address", async () => {
      // Open Food Facts asks every client to identify itself. The version is
      // read from the manifest, apart from the service, so a hand-written one
      // (it was `1.0` while the release was 0.1.0-alpha.3) fails, as does a
      // contact the project does not own (it was `contact@stoky.app`).
      upstream(() =>
        json({ code: "1234567890123", product: { code: "1" }, status: 1 }),
      );

      await client.getProductByBarcode("1234567890123");

      const { version } = JSON.parse(
        readFileSync(join(import.meta.dir, "../../../package.json"), "utf8"),
      ) as { version: string };
      expect(new Headers(calls[0]?.init?.headers).get("user-agent")).toBe(
        `Stoky/${version} (+https://github.com/NGarate/stoky)`,
      );
    });

    it("does not let one caller's edits reach the next", async () => {
      // The `Map` cache handed out a shared reference, so a caller that
      // mutated the product it got changed what every later caller saw.
      // Serialising through the cache makes that impossible.
      upstream(() =>
        json({
          code: "1234567890123",
          product: { code: "1234567890123", product_name: "Leche entera" },
          status: 1,
          status_verbose: "product found",
        }),
      );

      const first = await client.getProductByBarcode("1234567890123");
      (first as { product_name?: string }).product_name = "mutated";
      const second = await client.getProductByBarcode("1234567890123");

      expect(second?.product_name).toBe("Leche entera");
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

      return {
        calls,
        restore: () => {
          global.fetch = originalFetch;
        },
      };
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
          await new OpenFoodFactsClient(cache).getProductByBarcode(
            barcode,
            beforeFetch,
          ),
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
        return originalFetch(
          `http://127.0.0.1:${server.port}${pathname}${search}`,
          init,
        );
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
                controller.enqueue(
                  new TextEncoder().encode(`{"code":"${barcode}",`),
                );
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
