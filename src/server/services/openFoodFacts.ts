import { z } from "zod";
import { UpstreamError } from "./errors";

const OFF_API_BASE = "https://world.openfoodfacts.org/api/v2";
const OFF_USER_AGENT = "Stoky/1.0 (contact@stoky.app)";

// Cache TTL: 30 days for product data
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// In-memory cache for development (should use Valkey/Redis in production)
const cache = new Map<
  string,
  { data: OpenFoodFactsProduct; timestamp: number }
>();

const offProductSchema = z.object({
  code: z.string(),
  product_name: z.string().optional(),
  brands: z.string().optional(),
  categories: z.string().optional(),
  image_url: z.string().optional(),
  image_front_url: z.string().optional(),
  quantity: z.string().optional(),
  serving_quantity: z.string().optional(),
  nutriments: z
    .object({
      energy_kcal: z.number().optional(),
      proteins: z.number().optional(),
      carbohydrates: z.number().optional(),
      fat: z.number().optional(),
    })
    .optional(),
  ingredients_text: z.string().optional(),
  allergens: z.string().optional(),
});

const offResponseSchema = z.object({
  code: z.string(),
  product: offProductSchema.optional(),
  status: z.number(),
  status_verbose: z.string(),
});

export type OpenFoodFactsProduct = z.infer<typeof offProductSchema>;
export type OpenFoodFactsResponse = z.infer<typeof offResponseSchema>;

export class OpenFoodFactsClient {
  /**
   * Fetch product by barcode from Open Food Facts API
   */
  async getProductByBarcode(
    barcode: string
  ): Promise<OpenFoodFactsProduct | null> {
    // Check cache first
    const cacheKey = `off:${barcode}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const response = await fetch(
        `${OFF_API_BASE}/product/${barcode}.json?fields=code,product_name,brands,categories,image_url,image_front_url,quantity,serving_quantity,nutriments,ingredients_text,allergens`,
        {
          headers: {
            "User-Agent": OFF_USER_AGENT,
          },
        }
      );

      if (!response.ok) {
        throw new UpstreamError(`Open Food Facts answered ${response.status}`, response.status);
      }

      const rawData = await response.json();
      const parsed = offResponseSchema.parse(rawData);

      if (parsed.status !== 1 || !parsed.product) {
        return null;
      }

      // Cache the result
      cache.set(cacheKey, {
        data: parsed.product,
        timestamp: Date.now(),
      });

      return parsed.product;
    } catch (error) {
      console.error("Error fetching from Open Food Facts:", error);
      return null;
    }
  }

  /**
   * Search products by name
   */
  async searchProducts(
    query: string,
    limit = 10
  ): Promise<OpenFoodFactsProduct[]> {
    try {
      const response = await fetch(
        `${OFF_API_BASE}/search?search_terms=${encodeURIComponent(
          query
        )}&fields=code,product_name,brands,categories,image_url,image_front_url&page_size=${limit}&sort_by=popularity`,
        {
          headers: {
            "User-Agent": OFF_USER_AGENT,
          },
        }
      );

      if (!response.ok) {
        throw new UpstreamError(`Open Food Facts answered ${response.status}`, response.status);
      }

      const data = await response.json();

      if (!data.products || !Array.isArray(data.products)) {
        return [];
      }

      const products: OpenFoodFactsProduct[] = [];
      for (const product of data.products) {
        const parsed = offProductSchema.safeParse(product);
        if (parsed.success) {
          products.push(parsed.data);
        }
      }

      return products;
    } catch (error) {
      console.error("Error searching Open Food Facts:", error);
      return [];
    }
  }

  /**
   * Extract unit from quantity string (e.g., "500g" -> "g", "1.5L" -> "L")
   */
  extractUnit(quantity?: string): string {
    if (!quantity) return "unit";

    const normalizedQuantity = quantity.trim().toLowerCase();
    if (!normalizedQuantity) return "unit";

    const compactMatch = normalizedQuantity.match(
      /\d+(?:[.,]\d+)?([a-z]+)$/,
    );
    if (compactMatch) {
      const compactUnit = compactMatch[1];
      if (normalizedQuantity.includes("x") && /^(cl|ml|l)$/.test(compactUnit)) {
        return "l";
      }
      return compactUnit;
    }

    const spacedMatch = normalizedQuantity.match(/\d+(?:[.,]\d+)?\s+([a-z]+)$/);
    if (spacedMatch) {
      const spacedUnit = spacedMatch[1];
      if (spacedUnit === "kg" || spacedUnit === "g") return "g";
      if (/^(ml|cl|l)$/.test(spacedUnit)) return "l";
      if (spacedUnit.endsWith("s")) return "s";
    }

    return "unit";
  }

  /**
   * Clear cache for a specific barcode
   */
  clearCache(barcode: string): void {
    cache.delete(`off:${barcode}`);
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    cache.clear();
  }
}

// Export singleton instance
export const openFoodFacts = new OpenFoodFactsClient();
