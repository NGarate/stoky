import { describe, it, expect } from "bun:test";
import {
  computeRating,
  normaliseAdditiveTag,
  ratingFromSnapshot,
  type Rating,
} from "@/lib/rating";

/**
 * The rating — Phase 6's formula, and the honesty rules that outrank it.
 *
 * The rules get the first describes because they matter more (§6): a wrong
 * number misleads one purchase, an invented number poisons trust in all of
 * them. The formula tests then pin the published weights — 60/30/10 — and the
 * one structural decision inside the additives component: the worst additive
 * present decides it, undiluted by harmless neighbours.
 */

function rated(rating: Rating): Extract<Rating, { kind: "rated" }> {
  expect(rating.kind).toBe("rated");
  return rating as Extract<Rating, { kind: "rated" }>;
}

describe("the honesty rules", () => {
  it("invents no number when there is no Nutri-Score", () => {
    expect(computeRating({}).kind).toBe("noData");
    expect(computeRating({ nutriscore_grade: "unknown" }).kind).toBe("noData");
  });

  it("treats a vocabulary surprise as missing data, not as a crash or a guess", () => {
    // The schema deliberately keeps the grade a plain string; this is the
    // downstream half of that decision.
    expect(computeRating({ nutriscore_grade: "z" }).kind).toBe("noData");
    expect(computeRating({ nutriscore_grade: "" }).kind).toBe("noData");
  });

  it("does not score non-food", () => {
    // OFF's own answer for categories Nutri-Score does not cover. Toilet paper
    // is not bad food, and a low score would say it was.
    expect(computeRating({ nutriscore_grade: "not-applicable" }).kind).toBe(
      "notApplicable",
    );
  });

  it("still refuses a number when everything except the grade is present", () => {
    // 60% of the formula is the grade. Scoring the remaining 40% and showing
    // it as a total would present a ceiling of 40 as if it meant something.
    const rating = computeRating({
      additives_tags: [],
      additives_n: 0,
      labels_tags: ["en:organic"],
    });

    expect(rating.kind).toBe("noData");
  });
});

describe("the formula", () => {
  it("maps the five grades linearly across 60 points", () => {
    const points = ["a", "b", "c", "d", "e"].map(
      (grade) =>
        rated(computeRating({ nutriscore_grade: grade, additives_n: 0 }))
          .breakdown.nutritional.points,
    );

    expect(points).toEqual([60, 45, 30, 15, 0]);
  });

  it("gives a clean organic product the full hundred", () => {
    const rating = rated(
      computeRating({
        nutriscore_grade: "a",
        additives_n: 0,
        additives_tags: [],
        labels_tags: ["en:organic"],
      }),
    );

    expect(rating.score).toBe(100);
    expect(rating.word).toBe("excellent");
  });

  it("scores §6's own worked example the way the plan reads", () => {
    // Nutella, from the verified API response in the plan: grade e, two
    // lecithin tags, not organic. Nutritional 0, additives none-class 25,
    // organic 0 → 25, which is the bottom edge of "poor" rather than "bad" —
    // the additives being harmless is worth exactly that much.
    const rating = rated(
      computeRating({
        nutriscore_grade: "e",
        additives_n: 2,
        additives_tags: ["en:e322", "en:e322i"],
      }),
    );

    expect(rating.score).toBe(25);
    expect(rating.word).toBe("poor");
  });

  it("lets the worst additive decide the component, undiluted", () => {
    // One azo colourant among ten harmless gums is still an azo colourant.
    const clean = rated(
      computeRating({ nutriscore_grade: "a", additives_tags: ["en:e330"] }),
    );
    const mixed = rated(
      computeRating({
        nutriscore_grade: "a",
        additives_tags: ["en:e330", "en:e102"],
      }),
    );

    expect(clean.breakdown.additives.points).toBe(25);
    expect(mixed.breakdown.additives.points).toBe(0);
    expect(mixed.breakdown.additives.worst).toBe("high");
  });

  it("defaults an unlisted additive to limited, not to safe", () => {
    // Absence from the risk table is absence of a verdict.
    const rating = rated(
      computeRating({ nutriscore_grade: "a", additives_tags: ["en:e999"] }),
    );

    expect(rating.breakdown.additives.points).toBe(20);
    expect(rating.breakdown.additives.worst).toBe("limited");
  });

  it("distinguishes 'no additives' from 'no additive data'", () => {
    // OFF omits fields it has no data for, so an absent list is not a clean
    // bill — only `additives_n: 0` is an actual statement of none.
    const stated = rated(
      computeRating({ nutriscore_grade: "a", additives_n: 0 }),
    );
    const unstated = rated(computeRating({ nutriscore_grade: "a" }));

    expect(stated.breakdown.additives.points).toBe(30);
    expect(unstated.breakdown.additives.points).toBe(20);
  });

  it("draws the word boundaries at 75, 50 and 25", () => {
    // grade b + stated no additives + not organic = 45 + 30 = 75 exactly.
    expect(
      rated(computeRating({ nutriscore_grade: "b", additives_n: 0 })).word,
    ).toBe("excellent");
    // grade c + no-verdict additives = 30 + 20 = 50 exactly.
    expect(rated(computeRating({ nutriscore_grade: "c" })).word).toBe("good");
    // grade e + none-class additives = 0 + 25 = 25 exactly.
    expect(
      rated(
        computeRating({ nutriscore_grade: "e", additives_tags: ["en:e322"] }),
      ).word,
    ).toBe("poor");
    // grade e + high-risk = 0.
    expect(
      rated(
        computeRating({ nutriscore_grade: "e", additives_tags: ["en:e250"] }),
      ).word,
    ).toBe("bad");
  });

  it("counts organic certification as ten points, from any organic label", () => {
    const eu = rated(
      computeRating({ nutriscore_grade: "c", labels_tags: ["en:eu-organic"] }),
    );
    const none = rated(
      computeRating({ nutriscore_grade: "c", labels_tags: ["en:vegetarian"] }),
    );

    expect(eu.breakdown.organic.points).toBe(10);
    expect(none.breakdown.organic.points).toBe(0);
  });
});

describe("what the breakdown carries", () => {
  it("says what lowered it, worst first", () => {
    // §6: tapping the score always shows the reason. The interface reads this
    // structure directly, so its shape is the contract.
    const rating = rated(
      computeRating({
        nutriscore_grade: "d",
        additives_tags: ["en:e330", "en:e102"],
        labels_tags: [],
      }),
    );

    expect(rating.breakdown.nutritional).toEqual({
      grade: "d",
      points: 15,
      max: 60,
    });
    expect(rating.breakdown.additives.tags).toEqual(["e102", "e330"]);
    expect(rating.breakdown.organic.isOrganic).toBe(false);
  });
});

describe("tag normalisation", () => {
  it("strips the language prefix and sub-variant suffix", () => {
    expect(normaliseAdditiveTag("en:e322i")).toBe("e322");
    expect(normaliseAdditiveTag("en:E250")).toBe("e250");
    expect(normaliseAdditiveTag("e330")).toBe("e330");
  });

  it("rejects what is not an E-number", () => {
    expect(normaliseAdditiveTag("en:added-sugar")).toBeNull();
    expect(normaliseAdditiveTag("")).toBeNull();
  });
});

describe("from a stored snapshot", () => {
  it("computes from a product row's JSON", () => {
    const rating = ratingFromSnapshot({
      nutriscore_grade: "b",
      additives_n: 0,
      labels_tags: ["en:organic"],
    });

    expect(rated(rating).score).toBe(85);
  });

  it("answers noData for a snapshot from before these fields existed", () => {
    // Every product scanned before Phase 6 has one of these.
    expect(ratingFromSnapshot({ product_name: "Leche" }).kind).toBe("noData");
    expect(ratingFromSnapshot(null).kind).toBe("noData");
    expect(ratingFromSnapshot(undefined).kind).toBe("noData");
  });

  it("answers noData for a snapshot it cannot parse, rather than throwing", () => {
    expect(ratingFromSnapshot({ nutriscore_grade: 42 }).kind).toBe("noData");
    expect(ratingFromSnapshot("not an object").kind).toBe("noData");
  });
});
