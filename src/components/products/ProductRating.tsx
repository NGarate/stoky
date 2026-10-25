"use client";

import { useTranslations } from "next-intl";
import { ratingFromSnapshot, type AdditiveRisk } from "@/lib/rating";
import type { JSX } from "react";
import { Disclosure } from "@/components/ui/disclosure";

/**
 * The rating, on the product detail screen — Phase 6.
 *
 * Three states, and the honest two get real sentences rather than an empty
 * corner (§6): no data says so and links to where the data would come from;
 * non-food says it is not rated rather than wearing a low score.
 *
 * **The word leads; colour follows** (§6, and §3's "never colour alone"). The
 * palette has three AAA-checked pairs that fit — ok, muted, danger — so the
 * four words map excellent/good → ok, poor → muted, bad → danger. Four hues
 * would need a new token pair; the word is the information either way.
 *
 * The breakdown is a native `<details>`: §6 requires the score to show what
 * lowered it, and `<summary>` gives keyboard and screen-reader semantics
 * without owning any focus management here.
 *
 * The Open Food Facts attribution is unconditional. ODbL requires it wherever
 * the data is used, and the no-data state still used the database to find
 * nothing — the attribution line is also where "add its details" points.
 */

const WORD_KEY = {
  excellent: "wordExcellent",
  good: "wordGood",
  poor: "wordPoor",
  bad: "wordBad",
} as const;

const WORD_TONE = {
  excellent: "border-ok-foreground bg-ok text-ok-foreground",
  good: "border-ok-foreground bg-ok text-ok-foreground",
  poor: "border-border bg-muted text-foreground",
  bad: "border-danger-foreground bg-danger text-danger-foreground",
} as const;

const RISK_KEY: Record<AdditiveRisk, string> = {
  none: "riskNone",
  limited: "riskLimited",
  moderate: "riskModerate",
  high: "riskHigh",
};

interface ProductRatingProps {
  /** The `Product.openFoodFactsData` snapshot, straight off the row. */
  snapshot: unknown;
  /** For the contribute link; a product with no barcode links to the search. */
  barcode: string | null;
}

export function ProductRating({
  snapshot,
  barcode,
}: ProductRatingProps): JSX.Element {
  const t = useTranslations("products.rating");
  const rating = ratingFromSnapshot(snapshot);

  const offUrl = barcode
    ? `https://world.openfoodfacts.org/product/${encodeURIComponent(barcode)}`
    : "https://world.openfoodfacts.org";

  return (
    <section
      aria-labelledby="product-rating-heading"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2
        className="text-lg font-semibold text-heading"
        id="product-rating-heading"
      >
        {t("title")}
      </h2>

      {rating.kind === "noData" ? (
        <p className="mt-2 text-muted-foreground">
          {t("noData")}{" "}
          <a
            className="text-primary underline"
            href={offUrl}
            rel="noreferrer"
            target="_blank"
          >
            {t("noDataContribute")}
          </a>
        </p>
      ) : null}

      {rating.kind === "notApplicable" ? (
        <p className="mt-2 text-muted-foreground">{t("notApplicable")}</p>
      ) : null}

      {rating.kind === "rated" ? (
        <>
          <p
            className={`mt-3 inline-flex items-baseline gap-3 rounded-md border px-4 py-2 ${WORD_TONE[rating.word]}`}
          >
            <span className="text-2xl font-bold">
              {t(WORD_KEY[rating.word])}
            </span>
            <span className="text-sm">
              {t("scoreOutOf", { score: rating.score })}
            </span>
          </p>

          <Disclosure className="mt-3" summary={t("showWhy")} variant="inline">
            <ul className="mt-2 space-y-2 text-sm text-foreground">
              <li>
                {t("nutritional", {
                  grade: rating.breakdown.nutritional.grade.toUpperCase(),
                })}{" "}
                —{" "}
                {t("points", {
                  points: rating.breakdown.nutritional.points,
                  max: rating.breakdown.nutritional.max,
                })}
              </li>
              <li>
                {t("additives")} —{" "}
                {t("points", {
                  points: rating.breakdown.additives.points,
                  max: rating.breakdown.additives.max,
                })}
                {rating.breakdown.additives.tags.length > 0 ? (
                  <ul className="mt-1 list-inside list-disc text-muted-foreground">
                    {rating.breakdown.additives.tags.map(({ tag, risk }) => (
                      <li key={tag}>
                        {tag.toUpperCase()} · {t(RISK_KEY[risk])}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted-foreground">
                    {" "}
                    {rating.breakdown.additives.points === 30
                      ? t("additivesNone")
                      : t("additivesUnknown")}
                  </span>
                )}
              </li>
              <li>
                {rating.breakdown.organic.isOrganic
                  ? t("organicYes")
                  : t("organicNo")}{" "}
                —{" "}
                {t("points", {
                  points: rating.breakdown.organic.points,
                  max: rating.breakdown.organic.max,
                })}
              </li>
            </ul>
          </Disclosure>
        </>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground">
        <a className="underline" href={offUrl} rel="noreferrer" target="_blank">
          {t("attribution")}
        </a>
      </p>
    </section>
  );
}
