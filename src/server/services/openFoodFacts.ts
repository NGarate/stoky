import { z } from "zod";
import { UpstreamError } from "./errors";
import { valkeyProductCache, type ProductCache } from "./product-cache";

const OFF_API_BASE = "https://world.openfoodfacts.org/api/v2";
const OFF_USER_AGENT = "Stoky/1.0 (contact@stoky.app)";

/**
 * How long a barcode lookup may take, from the request to the last byte of
 * the answer, before it counts as Open Food Facts being unavailable.
 *
 * Without one, Bun's only bound is its five-minute idle timer, which every
 * byte resets: an Open Food Facts brownout, or an answer dripping in, held
 * `scanBarcode` and `resolveScan` open for minutes while the person waited
 * for a form they could have been filling in. The signal also covers the body
 * read (measured under Bun 1.4.2: a stalled body rejects at the deadline like
 * a stalled request), so the bound is the whole lookup. Five seconds is the
 * security audit's figure; past it the person is better served by the form.
 */
const OFF_TIMEOUT_MS = 5_000;

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
   *
   * `timeoutMs` is injectable so a test can prove the deadline without waiting
   * out the real one.
   */
  constructor(
    private readonly cache: ProductCache = valkeyProductCache,
    private readonly timeoutMs: number = OFF_TIMEOUT_MS,
  ) {}

  /**
   * Fetch product by barcode from Open Food Facts API.
   *
   * `beforeFetch` is asked once a lookup has missed both caches and is about
   * to leave for Open Food Facts, and at no other point — it is how the router
   * meters the requests an account makes this instance send
   * (`productLookupRateLimit`) without charging for answers already held.
   * `false` leaves the request unsent and answers null, like an outage. A
   * throw is the caller's refusal and reaches the caller as thrown: it runs
   * outside the catch below, which turns every failure into null, so a
   * throttled lookup is never mistaken for an unknown barcode.
   */
  async getProductByBarcode(
    barcode: string,
    beforeFetch?: () => Promise<boolean>,
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

    // Asked within the last day and Open Food Facts had no record of it.
    if (await this.cache.isMissing(barcode)) return null;

    if (beforeFetch && !(await beforeFetch())) return null;

    try {
      const response = await fetch(
        `${OFF_API_BASE}/product/${encodeURIComponent(barcode)}.json?fields=code,product_name,brands,categories,image_url,image_front_url,quantity,serving_quantity,nutriments,ingredients_text,allergens,nutriscore_grade,nova_group,additives_n,additives_tags,nutrient_levels,labels_tags`,
        {
          headers: {
            "User-Agent": OFF_USER_AGENT,
          },
          // A timeout lands in the catch below like any other failure: null,
          // the same fail-open answer as an outage, and never cached. It must
          // stay that way — `resolveScan` throws NOT_FOUND on null *before* it
          // claims its replay key, which is what leaves a retry of the same key
          // free to succeed once Open Food Facts answers again.
          signal: AbortSignal.timeout(this.timeoutMs),
        }
      );

      // A 404 is how the v2 API says "no such product" — HTTP 404 with a
      // `status: 0` body, measured against the live API on 2026-10-12 — so it
      // is read, not thrown. Any other non-2xx is OFF being unavailable.
      if (!response.ok && response.status !== 404) {
        throw new UpstreamError(`Open Food Facts answered ${response.status}`, response.status);
      }

      const rawData = await response.json();
      // A 404 that is not OFF's JSON — a proxy's error page — fails this parse
      // and lands in the catch: unavailable, not unknown, and not remembered.
      const parsed = offResponseSchema.parse(rawData);

      // The definitive "unknown": remembered for a day (`PRODUCT_MISS_TTL_SECONDS`),
      // so rescanning a code OFF does not have stops costing a request each
      // time. Only this answer — a timeout or an error status never reaches
      // here, and must stay asked again: `resolveScan` relies on a retry after
      // an outage being free to succeed.
      if (parsed.status === 0) {
        await this.cache.setMissing(barcode);
        return null;
      }

      // `status: 1` is not "OFF knows this product". An app that scans an
      // unknown code can make OFF create an empty stub (`"empty": 1`, no name,
      // completeness 0), after which the API answers "product found" with
      // nothing in it. Taking that as a hit created a nameless "Product <code>"
      // instead of sending the person to the form to name it. A record with
      // neither a name nor a brand identifies nothing, so it counts as unknown
      // — but is not remembered, even as a miss: a stub is a record somebody
      // has started, the likeliest to be named soon, and the next lookup sees
      // it once someone fills it in.
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
