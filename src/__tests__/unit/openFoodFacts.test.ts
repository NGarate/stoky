import { describe, it, expect, beforeEach } from "bun:test";
import { OpenFoodFactsClient, openFoodFacts } from "@/server/services/openFoodFacts";
import { memoryProductCache } from "@/server/services/product-cache";

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
      expect(client.extractUnit("1 oz")).toBe("unit"); // space breaks it
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

  describe("singleton instance", () => {
    it("should export singleton instance", () => {
      expect(openFoodFacts).toBeDefined();
      expect(openFoodFacts).toBeInstanceOf(OpenFoodFactsClient);
    });
  });
});
