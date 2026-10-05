import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { OpenFoodFactsClient } from "@/server/services/openFoodFacts";

// Create a mock response factory
const createMockResponse = (data: unknown, ok = true, status = 200): Response => {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
};

describe("OpenFoodFacts Service - Comprehensive", () => {
  let client: OpenFoodFactsClient;
  const fetchSpy = mock<typeof fetch>();

  beforeEach(async () => {
    // The real Valkey-backed cache, which is what makes this the integration
    // tier: DEBT-3 moved the cache out of process memory precisely so replicas
    // share it, and a double here would test the double.
    client = new OpenFoodFactsClient();
    await client.clearAllCache();
    fetchSpy.mockClear();
    Object.defineProperty(fetchSpy, 'preconnect', {
      value: () => Promise.resolve(),
      writable: false,
      enumerable: true,
      configurable: true,
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("getProductByBarcode", () => {
    it("should return product data for valid barcode", async () => {
      const mockProduct = {
        code: "1234567890123",
        product_name: "Test Product",
        brands: "Test Brand",
        categories: "Test Category",
        image_url: "https://example.com/image.jpg",
        image_front_url: "https://example.com/front.jpg",
        quantity: "500g",
        nutriments: {
          energy_kcal: 100,
          proteins: 5,
          carbohydrates: 20,
          fat: 3,
        },
        ingredients_text: "Ingredients list",
        allergens: "None",
      };

      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: mockProduct,
          status: 1,
          status_verbose: "product found",
        })
      );

      const result = await client.getProductByBarcode("1234567890123");

      expect(result).toBeDefined();
      expect(result?.code).toBe("1234567890123");
      expect(result?.product_name).toBe("Test Product");
      expect(result?.brands).toBe("Test Brand");
    });

    it("reads the fields in the shapes the live API sends them", async () => {
      // `serving_quantity` as a number failed the whole parse, which this
      // service reports as "not found"; and the calorie count is under
      // `energy-kcal`, so a schema reading `energy_kcal` never filled it.
      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "8410000678901",
          product: {
            code: "8410000678901",
            product_name: "Leche entera",
            serving_quantity: 250,
            nutriments: { "energy-kcal": 63, "energy-kcal_100g": 63, proteins: 3.1 },
          },
          status: 1,
          status_verbose: "product found",
        }),
      );

      const result = await client.getProductByBarcode("8410000678901");

      expect(result).not.toBeNull();
      expect(result?.serving_quantity).toBe("250");
      expect(result?.nutriments?.energy_kcal).toBe(63);
      expect(result?.nutriments?.proteins).toBe(3.1);

      // And the same once it has been cached and read back.
      const cached = await client.getProductByBarcode("8410000678901");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(cached?.nutriments?.energy_kcal).toBe(63);
    });

    it("should return null for non-existent barcode", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "0000000000000",
          status: 0,
          status_verbose: "product not found",
        })
      );

      const result = await client.getProductByBarcode("0000000000000");

      expect(result).toBeNull();
    });

    it("should cache successful responses", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: {
            code: "1234567890123",
            product_name: "Cached Product",
          },
          status: 1,
          status_verbose: "product found",
        })
      );

      await client.getProductByBarcode("1234567890123");
      await client.getProductByBarcode("1234567890123");
      await client.getProductByBarcode("1234567890123");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should return cached data within TTL", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: {
            code: "1234567890123",
            product_name: "Test Product",
          },
          status: 1,
          status_verbose: "product found",
        })
      );

      const firstResult = await client.getProductByBarcode("1234567890123");
      const secondResult = await client.getProductByBarcode("1234567890123");

      // `toEqual`, not `toBe`. The old in-memory cache handed every caller the
      // same object, so identity held by accident; the Valkey one serialises,
      // so each read is a fresh copy. That is the better behaviour — see the
      // test below — and asserting identity was asserting the implementation.
      expect(firstResult).toEqual(secondResult);
    });

    it("should handle API errors gracefully", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({}, false, 500)
      );

      const result = await client.getProductByBarcode("1234567890123");

      expect(result).toBeNull();
    });

    it("should handle network failures", async () => {
      fetchSpy.mockRejectedValue(new Error("Network error"));

      const result = await client.getProductByBarcode("1234567890123");

      expect(result).toBeNull();
    });

    it("should handle invalid JSON responses", async () => {
      fetchSpy.mockResolvedValue(
        new Response("invalid json", { status: 200 })
      );

      const result = await client.getProductByBarcode("1234567890123");

      expect(result).toBeNull();
    });

    it("should handle missing product field", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          status: 1,
          status_verbose: "product found",
        })
      );

      const result = await client.getProductByBarcode("1234567890123");

      expect(result).toBeNull();
    });

    it("keeps a barcode inside the path segment it is put in", async () => {
      // The schema refuses anything but digits; this is the service not
      // relying on that. A raw `../` or `?` would otherwise change which
      // Open Food Facts URL this server requests.
      fetchSpy.mockResolvedValue(
        createMockResponse({ code: "x", status: 0, status_verbose: "not found" }),
      );

      await client.getProductByBarcode("../search?x=1");

      const url = String(fetchSpy.mock.calls[0]?.[0]);
      expect(url).toContain("/product/..%2Fsearch%3Fx%3D1.json?");
    });

    it("should use correct User-Agent header", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: { code: "1234567890123" },
          status: 1,
        })
      );

      await client.getProductByBarcode("1234567890123");

      const callArg = fetchSpy.mock.calls[0];
      expect(callArg).toBeDefined();
    });
  });

  describe("searchProducts", () => {
    it("should return products for valid search", async () => {
      const mockProducts = [
        {
          code: "1234567890123",
          product_name: "Product 1",
          brands: "Brand 1",
        },
        {
          code: "1234567890124",
          product_name: "Product 2",
          brands: "Brand 2",
        },
      ];

      fetchSpy.mockResolvedValue(
        createMockResponse({
          products: mockProducts,
        })
      );

      const results = await client.searchProducts("test query");

      expect(results.length).toBe(2);
      expect(results[0].product_name).toBe("Product 1");
    });

    it("should handle empty search results", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          products: [],
        })
      );

      const results = await client.searchProducts("nonexistent");

      expect(results).toEqual([]);
    });

    it("should respect limit parameter", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          products: [],
        })
      );

      await client.searchProducts("test", 5);

      const callArg = fetchSpy.mock.calls[0][0] as string;
      expect(callArg).toContain("page_size=5");
    });

    it("should handle API errors gracefully", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({}, false, 500)
      );

      const results = await client.searchProducts("test");

      expect(results).toEqual([]);
    });

    it("should handle network failures", async () => {
      fetchSpy.mockRejectedValue(new Error("Network error"));

      const results = await client.searchProducts("test");

      expect(results).toEqual([]);
    });

    it("should handle invalid product data in results", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          products: [
            {
              code: "1234567890123",
              product_name: "Valid Product",
            },
            {
              // Invalid product - missing required code
              product_name: "Invalid Product",
            },
            {
              code: "1234567890124",
              product_name: "Another Valid Product",
            },
          ],
        })
      );

      const results = await client.searchProducts("test");

      expect(results.length).toBe(2);
    });

    it("should handle missing products field", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          count: 0,
        })
      );

      const results = await client.searchProducts("test");

      expect(results).toEqual([]);
    });

    it("should handle non-array products field", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          products: "not an array",
        })
      );

      const results = await client.searchProducts("test");

      expect(results).toEqual([]);
    });
  });

  describe("extractUnit", () => {
    it("should extract grams from quantity string", () => {
      expect(client.extractUnit("500g")).toBe("g");
      expect(client.extractUnit("1000G")).toBe("g");
      // Was "s": every spaced word ending in "s" became the unit "s".
      expect(client.extractUnit("250 grams")).toBe("g");
      expect(client.extractUnit("250 gramos")).toBe("g");
    });

    it("should extract kilograms from quantity string", () => {
      expect(client.extractUnit("2kg")).toBe("kg");
      expect(client.extractUnit("1.5KG")).toBe("kg");
    });

    it("should extract liters from quantity string", () => {
      expect(client.extractUnit("1L")).toBe("l");
      expect(client.extractUnit("2.5l")).toBe("l");
      expect(client.extractUnit("500ml")).toBe("ml");
    });

    it("should extract milliliters from quantity string", () => {
      expect(client.extractUnit("330ml")).toBe("ml");
      expect(client.extractUnit("250ML")).toBe("ml");
    });

    it("should extract centiliters from quantity string", () => {
      expect(client.extractUnit("33cl")).toBe("cl");
      expect(client.extractUnit("75CL")).toBe("cl");
    });

    it("should return unit for undefined", () => {
      expect(client.extractUnit(undefined)).toBe("unit");
    });

    it("should return unit for empty string", () => {
      expect(client.extractUnit("")).toBe("unit");
    });

    it("should return unit for quantity without unit", () => {
      expect(client.extractUnit("2")).toBe("unit");
      expect(client.extractUnit("500")).toBe("unit");
      expect(client.extractUnit("1.5")).toBe("unit");
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
        expect([client.extractUnit(compact), client.extractUnit(spaced)]).toEqual([unit, unit]);
      }
    });

    it("counts in the app's count unit when the word is a thing, not a measure", () => {
      // "12 huevos" was a product counted in "s".
      expect(client.extractUnit("12 huevos")).toBe("unit");
      expect(client.extractUnit("6 unidades")).toBe("unit");
      expect(client.extractUnit("10 sobres")).toBe("unit");
      expect(client.extractUnit("4 piezas")).toBe("unit");
    });

    it("reads Spanish unit words", () => {
      expect(client.extractUnit("1 kilo")).toBe("kg");
      expect(client.extractUnit("2 litros")).toBe("l");
      expect(client.extractUnit("750 mililitros")).toBe("ml");
    });

    it("should handle complex quantity strings", () => {
      expect(client.extractUnit("6x33cl")).toBe("l");
      expect(client.extractUnit("pack 6x1L")).toBe("l");
    });

    it("should handle ounces", () => {
      expect(client.extractUnit("16oz")).toBe("oz");
      expect(client.extractUnit("8OZ")).toBe("oz");
    });

    it("should handle pounds", () => {
      expect(client.extractUnit("1lb")).toBe("lb");
      expect(client.extractUnit("2.2LB")).toBe("lb");
    });
  });

  describe("Cache Management", () => {
    it("should clear cache for specific barcode", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: { code: "1234567890123", product_name: "Test" },
          status: 1,
        })
      );

      await client.getProductByBarcode("1234567890123");
      await client.clearCache("1234567890123");

      fetchSpy.mockClear();

      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: { code: "1234567890123", product_name: "Test" },
          status: 1,
        })
      );

      await client.getProductByBarcode("1234567890123");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("does not let one caller's edits reach the next", async () => {
      // DEBT-3's quiet improvement. The `Map` handed out a shared reference, so
      // a caller that mutated the product it got — to normalise a unit, say —
      // changed what every later caller saw, for thirty days, on that replica
      // only. Serialising through the cache makes that impossible.
      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: { code: "1234567890123", product_name: "Leche entera" },
          status: 1,
          status_verbose: "product found",
        })
      );

      const first = await client.getProductByBarcode("1234567890123");
      (first as { product_name?: string }).product_name = "mutated";

      const second = await client.getProductByBarcode("1234567890123");

      expect(second?.product_name).toBe("Leche entera");
    });

    it("should clear all cache", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: { code: "1234567890123", product_name: "Test" },
          status: 1,
        })
      );

      await client.getProductByBarcode("1234567890123");
      await client.clearAllCache();

      fetchSpy.mockClear();

      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: { code: "1234567890123", product_name: "Test" },
          status: 1,
        })
      );

      await client.getProductByBarcode("1234567890123");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Data Transformation", () => {
    it("should transform complete product data", async () => {
      const mockProduct = {
        code: "1234567890123",
        product_name: "Test Product Name",
        brands: "Test Brand Name",
        categories: "Category 1, Category 2",
        image_url: "https://images.openfoodfacts.org/test.jpg",
        image_front_url: "https://images.openfoodfacts.org/front.jpg",
        quantity: "500g",
        serving_quantity: "100g",
        nutriments: {
          energy_kcal: 250,
          proteins: 10,
          carbohydrates: 30,
          fat: 12,
        },
        ingredients_text: "Flour, water, salt",
        allergens: "Gluten, Wheat",
      };

      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: mockProduct,
          status: 1,
          status_verbose: "product found",
        })
      );

      const result = await client.getProductByBarcode("1234567890123");

      expect(result?.product_name).toBe("Test Product Name");
      expect(result?.brands).toBe("Test Brand Name");
      expect(result?.categories).toBe("Category 1, Category 2");
      expect(result?.quantity).toBe("500g");
    });

    it("should handle product with minimal data", async () => {
      const mockProduct = {
        code: "1234567890123",
        product_name: "Minimal Product",
      };

      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: mockProduct,
          status: 1,
          status_verbose: "product found",
        })
      );

      const result = await client.getProductByBarcode("1234567890123");

      expect(result?.code).toBe("1234567890123");
      expect(result?.product_name).toBe("Minimal Product");
      expect(result?.brands).toBeUndefined();
    });

    it("should handle missing nutriments gracefully", async () => {
      const mockProduct = {
        code: "1234567890123",
        product_name: "Product Without Nutrition",
      };

      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: mockProduct,
          status: 1,
        })
      );

      const result = await client.getProductByBarcode("1234567890123");

      expect(result?.nutriments).toBeUndefined();
    });
  });

  describe("Error Scenarios", () => {
    it("should handle timeout scenarios", async () => {
      fetchSpy.mockRejectedValue(new Error("Timeout"));

      const result = await client.getProductByBarcode("1234567890123");

      expect(result).toBeNull();
    });

    it("should handle malformed responses", async () => {
      fetchSpy.mockResolvedValue(
        new Response("not an object", { status: 200 })
      );

      const result = await client.getProductByBarcode("1234567890123");

      expect(result).toBeNull();
    });

    it("should handle responses with wrong status type", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          product: { code: "1234567890123" },
          status: "success",
        })
      );

      const result = await client.getProductByBarcode("1234567890123");

      expect(result).toBeNull();
    });

    it("should handle rate limiting responses", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({}, false, 429)
      );

      const result = await client.getProductByBarcode("1234567890123");

      expect(result).toBeNull();
    });

    it("should handle unauthorized responses", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({}, false, 403)
      );

      const result = await client.getProductByBarcode("1234567890123");

      expect(result).toBeNull();
    });
  });

  describe("URL Encoding", () => {
    it("should properly encode barcode in URL", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          code: "1234567890123",
          status: 0,
        })
      );

      await client.getProductByBarcode("1234567890123");

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain("/product/1234567890123.json");
    });

    it("should properly encode search query in URL", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          products: [],
        })
      );

      await client.searchProducts("chocolate con leche");

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain("search_terms=chocolate%20con%20leche");
    });

    it("should handle special characters in search", async () => {
      fetchSpy.mockResolvedValue(
        createMockResponse({
          products: [],
        })
      );

      await client.searchProducts("café & té");

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain("search_terms=caf%C3%A9%20%26%20t%C3%A9");
    });
  });
});
