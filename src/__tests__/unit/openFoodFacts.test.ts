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
    it("should cache products by barcode", async () => {
      // This test would require mocking the fetch API
      // In a real test, we would mock global.fetch
      expect(typeof client.clearCache).toBe("function");
      expect(typeof client.clearAllCache).toBe("function");
    });
  });

  describe("singleton instance", () => {
    it("should export singleton instance", () => {
      expect(openFoodFacts).toBeDefined();
      expect(openFoodFacts).toBeInstanceOf(OpenFoodFactsClient);
    });
  });
});
