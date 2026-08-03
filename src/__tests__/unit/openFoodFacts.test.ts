import { describe, it, expect, beforeEach } from "bun:test";
import { OpenFoodFactsClient, openFoodFacts } from "@/server/services/openFoodFacts";

describe("OpenFoodFacts Service", () => {
  let client: OpenFoodFactsClient;

  beforeEach(() => {
    client = new OpenFoodFactsClient();
    client.clearAllCache();
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
            },
          }),
        };
      }) as unknown as typeof fetch;

      return { calls, restore: () => { global.fetch = originalFetch; } };
    }

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
        client.clearCache(barcode);
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
        client.clearAllCache();
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
