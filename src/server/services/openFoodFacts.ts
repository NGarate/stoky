import { z } from "zod";
import { UpstreamError } from "./errors";
import { valkeyProductCache, type ProductCache } from "./product-cache";

const OFF_API_BASE = "https://world.openfoodfacts.org/api/v2";
const OFF_USER_AGENT = "Stoky/1.0 (contact@stoky.app)";

/** What `extractUnit` answers for a count, or for anything it cannot read. */
const COUNT_UNIT = "unit";

/**
 * Every way a label writes a unit this application measures in, Spanish
 * first, mapped to the one spelling it stores.
 */
const UNIT_WORDS: Record<string, string> = {
  g: "g", gr: "g", grs: "g", gramo: "g", gramos: "g", gram: "g", grams: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
  kilogram: "kg", kilograms: "kg",
  mg: "mg",
  ml: "ml", mililitro: "ml", mililitros: "ml", millilitre: "ml", millilitres: "ml",
  milliliter: "ml", milliliters: "ml",
  cl: "cl", centilitro: "cl", centilitros: "cl",
  l: "l", litro: "l", litros: "l", litre: "l", litres: "l", liter: "l", liters: "l",
  oz: "oz", lb: "lb", lbs: "lb",
};

const VOLUME_UNITS = new Set(["ml", "cl", "l"]);


const offProductSchema = z.object({
  code: z.string(),
  product_name: z.string().optional(),
  brands: z.string().optional(),
  categories: z.string().optional(),
  image_url: z.string().optional(),
  image_front_url: z.string().optional(),
  quantity: z.string().optional(),
  // A number for some products and a string for others — the live API does
  // both. Typed as a string only, a numeric one failed the whole parse, and
  // `getProductByBarcode` reports a failed parse as "not found": a product
  // Open Food Facts knows came back as unknown over a field nothing reads.
  serving_quantity: z
    .union([z.string(), z.number()])
    .transform((value) => String(value))
    .optional(),
  nutriments: z
    .object({
      // OFF's key is `energy-kcal`, with a hyphen, and the normalised
      // `energy-kcal_100g` beside it. Nothing ever sends `energy_kcal`, so
      // the field this schema promised was never filled. Read from OFF's
      // keys and stored under ours; `energy_kcal` itself stays accepted
      // because that is how a product this schema already parsed comes
      // back out of the cache.
      energy_kcal: z.number().optional(),
      "energy-kcal": z.number().optional(),
      "energy-kcal_100g": z.number().optional(),
      proteins: z.number().optional(),
      carbohydrates: z.number().optional(),
      fat: z.number().optional(),
    })
    .transform(
      ({ "energy-kcal": kcal, "energy-kcal_100g": kcal100g, energy_kcal, ...rest }) => ({
        ...rest,
        energy_kcal: energy_kcal ?? kcal ?? kcal100g,
      }),
    )
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

/** Whether an Open Food Facts record says what the product is. */
function identifiesAProduct(product: OpenFoodFactsProduct): boolean {
  return Boolean(product.product_name?.trim() || product.brands?.trim());
}

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
      // A stub cached before stubs were refused is dropped like a stale shape.
      if (revived.success && identifiesAProduct(revived.data)) return revived.data;
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

      // `status: 1` is not "OFF knows this product". An app that scans an
      // unknown code can make OFF create an empty stub (`"empty": 1`, no name,
      // completeness 0), after which the API answers "product found" with
      // nothing in it. Taking that as a hit created a nameless "Product <code>"
      // instead of sending the person to the form to name it. A record with
      // neither a name nor a brand identifies nothing, so it counts as unknown
      // and is not cached: the next lookup sees it once someone fills it in.
      if (parsed.status !== 1 || !parsed.product || !identifiesAProduct(parsed.product)) {
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
   * The unit a new product counts in, from Open Food Facts' free-text
   * `quantity` ("500 g", "1,5L", "6x33cl", "12 huevos").
   *
   * One vocabulary whether or not there is a space. There used to be two
   * paths that disagreed: "1kg" gave `kg` and "1 kg" gave `g`, "500ml" gave
   * `ml` and "500 ml" gave `l` — and any spaced word ending in "s" gave the
   * unit `s`, so "12 huevos" became a product counted in "s" and "250 grams"
   * one counted in "s" too.
   *
   * A word this table does not know — "huevos", "piezas", "unidades",
   * "sobres" — is a count, and a count is the app's own count unit, `unit`:
   * the `Product.defaultUnit` default and one of the spellings
   * `countUnitSize` reads as one. Guessing a unit out of an unknown word is
   * how "s" happened.
   *
   * A multipack of a liquid ("6x33cl", "pack 6x1L") is counted in litres,
   * as before: the pack is what is bought, and its total is the useful
   * number.
   */
  extractUnit(quantity?: string): string {
    const normalized = quantity?.trim().toLowerCase() ?? "";

    const match = normalized.match(/\d+(?:[.,]\d+)?\s*([a-záéíóúñ]+)\.?$/);
    if (!match) return COUNT_UNIT;

    const unit = UNIT_WORDS[match[1]];
    if (!unit) return COUNT_UNIT;

    if (/\d\s*x\s*\d/.test(normalized) && VOLUME_UNITS.has(unit)) return "l";
    return unit;
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
