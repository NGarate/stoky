import { z } from "zod";
import { UpstreamError } from "./errors";
import { valkeyProductCache, type ProductCache } from "./product-cache";

const OFF_API_BASE = "https://world.openfoodfacts.org/api/v2";
const OFF_USER_AGENT = "Stoky/1.0 (contact@stoky.app)";


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

  // The rating's inputs — Phase 6. All optional, because their absence is a
  // *state the interface shows* ("we don't have information on this product"),
  // never an error. Verified shapes against the live API in REDESIGN_PLAN §6.
  //
  // `nutriscore_grade` is a|b|c|d|e, or the literal strings "unknown" /
  // "not-applicable" — left as z.string() rather than an enum so an OFF
  // vocabulary change degrades to "no data" instead of failing the parse and
  // discarding the whole product.
  nutriscore_grade: z.string().optional(),
  nova_group: z.number().optional(),
  additives_n: z.number().optional(),
  additives_tags: z.array(z.string()).optional(),
  nutrient_levels: z
    .object({
      fat: z.string().optional(),
      salt: z.string().optional(),
      sugars: z.string().optional(),
      "saturated-fat": z.string().optional(),
    })
    .optional(),
  labels_tags: z.array(z.string()).optional(),
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
   * Where lookups are remembered — ISSUES.md DEBT-3.
   *
   * Valkey by default, so replicas share one answer instead of each fetching
   * the same barcode and disagreeing after an upstream edit. Injectable because
   * the unit tier must not need a service running; see `product-cache.ts`.
   */
  constructor(private readonly cache: ProductCache = valkeyProductCache) {}

  /**
   * Fetch product by barcode from Open Food Facts API
   */
  async getProductByBarcode(
    barcode: string
  ): Promise<OpenFoodFactsProduct | null> {
    const cached = await this.cache.get(barcode);
    if (cached !== null) {
      // Parsed rather than trusted. The cache is shared and outlives a deploy,
      // so an entry written by an older shape of this schema would otherwise
      // reach a caller as a valid product with fields missing.
      const revived = offProductSchema.safeParse(JSON.parse(cached));
      if (revived.success) return revived.data;
      await this.cache.delete(barcode);
    }

    try {
      const response = await fetch(
        `${OFF_API_BASE}/product/${encodeURIComponent(barcode)}.json?fields=code,product_name,brands,categories,image_url,image_front_url,quantity,serving_quantity,nutriments,ingredients_text,allergens,nutriscore_grade,nova_group,additives_n,additives_tags,nutrient_levels,labels_tags`,
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

      await this.cache.set(barcode, JSON.stringify(parsed.product));

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

  /** Forget one barcode. */
  async clearCache(barcode: string): Promise<void> {
    await this.cache.delete(barcode);
  }

  /** Forget every barcode this application cached. */
  async clearAllCache(): Promise<void> {
    await this.cache.clear();
  }
}

// Export singleton instance
export const openFoodFacts = new OpenFoodFactsClient();
