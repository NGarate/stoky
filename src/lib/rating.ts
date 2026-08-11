/**
 * The rating — Phase 6, computed from Open Food Facts data and explained.
 *
 * The reference point is Yuka's published methodology; **the brand and the
 * algorithm are not copied**. The weights follow the method they describe in
 * public — 60% nutritional quality, 30% additives, 10% organic — and everything
 * inside each component is this project's own: the additive risk classes are a
 * small curated table with its sources named, not anybody's proprietary list.
 *
 * **The honesty rules outrank the formula** (REDESIGN_PLAN §6):
 *
 * - No usable data → no invented number. The result says `noData` and the
 *   interface says "we don't have information on this product".
 * - Non-food → `notApplicable`, not a low score. Toilet paper is not bad food.
 * - A score always carries its breakdown, because a number without a reason
 *   helps nobody decide — the interface's "what lowered it" reads it directly.
 *
 * Pure, so the whole thing is unit-testable and callable on either side: the
 * server stores the OFF snapshot on the product row, and the client computes
 * from it.
 */

import { z } from "zod";

/** What the rating reads. A subset of the OFF product, revalidated here
 * because the snapshot on a `Product` row may predate these fields. */
export const ratingInputSchema = z.object({
  nutriscore_grade: z.string().optional(),
  additives_tags: z.array(z.string()).optional(),
  additives_n: z.number().optional(),
  labels_tags: z.array(z.string()).optional(),
});

export type RatingInput = z.infer<typeof ratingInputSchema>;

export type RatingWord = "excellent" | "good" | "poor" | "bad";

export type AdditiveRisk = "none" | "limited" | "moderate" | "high";

export interface RatingBreakdown {
  nutritional: { grade: string; points: number; max: 60 };
  additives: {
    /** Normalised E-numbers found, worst first. */
    tags: string[];
    worst: AdditiveRisk | null;
    points: number;
    max: 30;
  };
  organic: { isOrganic: boolean; points: number; max: 10 };
}

export type Rating =
  | { kind: "rated"; score: number; word: RatingWord; breakdown: RatingBreakdown }
  | { kind: "noData" }
  | { kind: "notApplicable" };

/**
 * Coarse risk classes for the additives people actually meet, with the public
 * assessments they lean on. Coarse on purpose: this is a shopping aid, not a
 * toxicology database, and a class per additive is as far as the evidence
 * supports going without pretending to precision.
 *
 * - `high`: the azo colourings that carry the EU's mandatory hyperactivity
 *   warning (E102, E104, E110, E122, E124, E129); titanium dioxide (E171),
 *   which EFSA concluded in 2021 could no longer be considered safe; and the
 *   curing nitrites/nitrates (E249–E252), IARC group 1 exposure route.
 * - `moderate`: BHA/BHT (E320/E321, possible carcinogens per IARC 2B),
 *   carrageenan (E407), caramel colour E150d (4-MEI), MSG (E621), aspartame
 *   (E951, IARC 2B as of 2023).
 * - `none`: vitamins and kitchen-cupboard acids and gums — ascorbic acid
 *   (E300), tocopherols (E306–E308), lecithins (E322), citric acid (E330),
 *   locust bean (E410), guar (E412), xanthan (E415), pectin (E440).
 *
 * **Anything not listed is `limited`** — present in the score, mildly, because
 * absence from this table is absence of a verdict, not a verdict of safety.
 */
const ADDITIVE_RISK: Record<string, AdditiveRisk> = {
  e102: "high", e104: "high", e110: "high", e122: "high", e124: "high",
  e129: "high", e171: "high", e249: "high", e250: "high", e251: "high",
  e252: "high",
  e150d: "moderate", e320: "moderate", e321: "moderate", e407: "moderate",
  e621: "moderate", e951: "moderate",
  e300: "none", e306: "none", e307: "none", e308: "none", e322: "none",
  e330: "none", e410: "none", e412: "none", e415: "none", e440: "none",
};

/** 60% of the score, linearly across the five grades. */
const NUTRISCORE_POINTS: Record<string, number> = {
  a: 60, b: 45, c: 30, d: 15, e: 0,
};

/**
 * 30% of the score, and the worst additive present decides it — one high-risk
 * colourant is not diluted by ten harmless gums beside it.
 */
const ADDITIVE_POINTS: Record<AdditiveRisk, number> = {
  none: 25, limited: 20, moderate: 10, high: 0,
};

const RISK_ORDER: AdditiveRisk[] = ["none", "limited", "moderate", "high"];

/**
 * `en:e322i` → `e322`. OFF tags carry a language prefix and sub-variant
 * suffixes; the risk table speaks in base E-numbers.
 */
export function normaliseAdditiveTag(tag: string): string | null {
  const match = /^(?:[a-z]{2}:)?(e\d+)/i.exec(tag.trim());
  return match ? match[1].toLowerCase() : null;
}

/** OFF canonicalises organic labels into the `en:` namespace — `en:organic`,
 * `en:eu-organic`, `en:organic-cotton`… A label tag is enough; certification
 * detail is not this feature's business. */
function isOrganic(labels: string[] | undefined): boolean {
  return (labels ?? []).some((tag) => /^en:.*organic/.test(tag));
}

export function computeRating(input: RatingInput): Rating {
  const grade = input.nutriscore_grade?.trim().toLowerCase();

  // The honesty rules, before any arithmetic.
  //
  // "not-applicable" is OFF's own answer for categories Nutri-Score does not
  // cover — the non-food case §6 names. Anything else unrecognised (absent,
  // "unknown", a future vocabulary change) is missing data, and missing data
  // is never a number.
  if (grade === "not-applicable") return { kind: "notApplicable" };
  if (grade === undefined || !(grade in NUTRISCORE_POINTS)) {
    return { kind: "noData" };
  }

  const nutritionalPoints = NUTRISCORE_POINTS[grade];

  const tags = (input.additives_tags ?? [])
    .map(normaliseAdditiveTag)
    .filter((tag): tag is string => tag !== null);

  // `additives_tags` absent does not mean additive-free — OFF omits fields it
  // has no data for. `additives_n === 0` is an actual statement of none;
  // absence of both statements scores the component cautiously as `limited`,
  // for the same reason unknown additives do: no verdict is not a clean bill.
  let worst: AdditiveRisk | null = null;
  let additivePoints: number;
  if (tags.length > 0) {
    worst = tags
      .map((tag) => ADDITIVE_RISK[tag] ?? "limited")
      .reduce((a, b) => (RISK_ORDER.indexOf(b) > RISK_ORDER.indexOf(a) ? b : a));
    additivePoints = ADDITIVE_POINTS[worst];
  } else if (input.additives_n === 0) {
    additivePoints = 30;
  } else {
    additivePoints = ADDITIVE_POINTS.limited;
  }

  const organic = isOrganic(input.labels_tags);
  const organicPoints = organic ? 10 : 0;

  const score = nutritionalPoints + additivePoints + organicPoints;

  // The word leads; colour follows it in the interface (§6).
  const word: RatingWord =
    score >= 75 ? "excellent" : score >= 50 ? "good" : score >= 25 ? "poor" : "bad";

  return {
    kind: "rated",
    score,
    word,
    breakdown: {
      nutritional: { grade, points: nutritionalPoints, max: 60 },
      additives: {
        tags: [...tags].sort(
          (a, b) =>
            RISK_ORDER.indexOf(ADDITIVE_RISK[b] ?? "limited") -
            RISK_ORDER.indexOf(ADDITIVE_RISK[a] ?? "limited"),
        ),
        worst,
        points: additivePoints,
        max: 30,
      },
      organic: { isOrganic: organic, points: organicPoints, max: 10 },
    },
  };
}

/**
 * The bridge from a stored `Product.openFoodFactsData` snapshot, which is
 * `unknown` to the type system and may predate the rating fields entirely.
 * Anything unparseable is honestly `noData`.
 */
export function ratingFromSnapshot(snapshot: unknown): Rating {
  const parsed = ratingInputSchema.safeParse(snapshot ?? {});
  if (!parsed.success) return { kind: "noData" };
  return computeRating(parsed.data);
}
