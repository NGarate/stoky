import { describe, it, expect } from "bun:test";
import es from "../../../messages/es.json";
import en from "../../../messages/en.json";
import {
  countEnglishSyllables,
  countSpanishSyllables,
  infleszBand,
  readability,
  toProse,
  type SupportedLocale,
} from "@/lib/readability";

/**
 * WCAG 2.1 **3.1.5 Reading Level**, measured on the catalogues.
 *
 * AAA, and one of the few AAA criteria a machine can decide at all — pa11y's
 * WCAG2AAA standard emits "Check that…" for it and stops. It is here because
 * REDESIGN_PLAN.md's premise is "anyone in a household can use this, including
 * people with limited technical confidence", and nothing checked that sentence
 * against the words the application actually shows.
 *
 * **Why the gate is on the corpus and on long strings, not on every string.**
 * Flesch and Fernández-Huerta are calibrated on passages. Below roughly twenty
 * words they are noise: "Nothing is missing: everything is above its minimum."
 * scores 29.5 in English and is as plain as that sentence can be, because the
 * formula counts syllables and does not know that "everything" is a common
 * word. A per-string floor at that length would fail good copy, and a gate that
 * cries wolf teaches people to raise the gate.
 *
 * So: the corpus is gated, long strings are gated where the formula means
 * something, and short strings are reported rather than enforced.
 */

type Entry = { key: string; text: string };

function flatten(node: unknown, prefix = ""): Entry[] {
  if (typeof node === "string") return [{ key: prefix, text: node }];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

const CATALOGUES: Array<{ locale: SupportedLocale; entries: Entry[] }> = [
  { locale: "es", entries: flatten(es) },
  { locale: "en", entries: flatten(en) },
];

/**
 * The floors.
 *
 * Spanish reads on INFLESZ, where 65 is "fácil" and 55 "normal". English reads
 * on Flesch, where 60–70 is "plain English". The two numbers are not
 * comparable and must not be unified: Spanish words carry more syllables at the
 * same difficulty, so one formula applied to both reports Spanish as harder
 * than it is.
 *
 * Set from the measurement with headroom, not at it — measured on 2026-08-11
 * at es 69.0 / en 66.3 for the corpus, and es 58.5 / en 45.0 for the worst
 * string of twelve words or more.
 */
const FLOORS: Record<SupportedLocale, { corpus: number; longString: number }> =
  {
    es: { corpus: 65, longString: 50 },
    en: { corpus: 60, longString: 35 },
  };

/**
 * Where the formula stops being noise.
 *
 * Twelve, and it was twenty until a deliberately unreadable seventeen-word
 * sentence was pasted into both catalogues to check the gate fires and nothing
 * went red. It scored −47 and slipped through: too short to be judged, and one
 * string among 515 does not move a corpus average. A gate with a hole that size
 * is the "guard nobody has watched fire" this project keeps rediscovering.
 *
 * Twelve is where the measurement still has headroom — the worst real string is
 * 58.5 in Spanish and 45 in English — and where nothing plausible escapes.
 */
const LONG_ENOUGH_TO_JUDGE = 12;

describe("reading level of the message catalogues (WCAG 3.1.5)", () => {
  for (const { locale, entries } of CATALOGUES) {
    it(`reads at or above the floor across the whole ${locale} catalogue`, () => {
      const corpus = entries.map((e) => e.text).join(" ");
      const { score } = readability(corpus, locale);

      expect(
        score,
        `${locale} corpus reads at ${score}` +
          (locale === "es" ? ` (${infleszBand(score)})` : "") +
          `, below the floor of ${FLOORS[locale].corpus}`,
      ).toBeGreaterThanOrEqual(FLOORS[locale].corpus);
    });

    it(`has no dense sentence of ${LONG_ENOUGH_TO_JUDGE}+ words in ${locale}`, () => {
      const judged = entries
        .map((e) => ({ ...e, result: readability(e.text, locale) }))
        .filter((e) => e.result.words >= LONG_ENOUGH_TO_JUDGE);

      // Without this the filter could silently match nothing and the assertion
      // below would pass over an empty list.
      expect(judged.length).toBeGreaterThan(20);

      const tooDense = judged
        .filter((e) => e.result.score < FLOORS[locale].longString)
        .map((e) => `  ${e.result.score} — ${e.key}: "${e.text.slice(0, 80)}"`);

      expect(
        tooDense,
        `strings below ${FLOORS[locale].longString}:\n${tooDense.join("\n")}`,
      ).toEqual([]);
    });
  }
});

describe("the measurement itself", () => {
  it("counts Spanish syllables through diphthongs and hiatus", () => {
    // A diphthong is one syllable; two strong vowels are two; an accented weak
    // vowel breaks the diphthong. Getting this wrong moves every Spanish score.
    expect(countSpanishSyllables("casa")).toBe(2);
    expect(countSpanishSyllables("tienda")).toBe(2); // ie is a diphthong
    expect(countSpanishSyllables("caer")).toBe(2); // a-e is a hiatus
    expect(countSpanishSyllables("día")).toBe(2); // í breaks the diphthong
    expect(countSpanishSyllables("aéreo")).toBe(4); // a-é-re-o
    expect(countSpanishSyllables("inventario")).toBe(4); // in-ven-ta-rio
    expect(countSpanishSyllables("guion")).toBe(1); // one syllable, per the RAE
  });

  it("counts English syllables where the heuristic is right", () => {
    expect(countEnglishSyllables("make")).toBe(1); // trailing e is silent
    expect(countEnglishSyllables("inventory")).toBe(4);
    expect(countEnglishSyllables("the")).toBe(1);
  });

  it("is wrong about English in both directions, by these amounts", () => {
    // Pinned rather than hidden. The vowel-group heuristic over-counts a word
    // with an internal silent e and under-counts a trailing consonant-le, and
    // no cheap heuristic gets both. English scores therefore carry a few points
    // of noise in each direction, which is why the English floor sits fifteen
    // points below the measurement rather than five, and why nothing here gates
    // a single short string.
    //
    // Spanish, where this application primarily ships, has no such problem: its
    // orthography is regular enough to count exactly, which the test above
    // shows.
    expect(countEnglishSyllables("household")).toBe(3); // house-hold is 2
    expect(countEnglishSyllables("people")).toBe(1); // peo-ple is 2
  });

  it("does not read a placeholder or a tag as prose", () => {
    // "{count} productos" must not be measured as if {count} were a word, or
    // every interpolated string reports a difficulty it does not have.
    expect(toProse("Hay {count} productos <b>aquí</b>")).toBe(
      "Hay productos aquí",
    );
  });

  it("does not read an ellipsis as three sentences", () => {
    // Three full stops would divide the word count by three and inflate the
    // score — "Guardando..." would come out as the easiest string in the app.
    const withEllipsis = readability("Guardando... espera un momento", "es");
    expect(withEllipsis.sentences).toBe(1);
  });

  it("scores simple prose above dense prose, in both languages", () => {
    // The direction is the whole claim. If this ever inverts, the formula has
    // been mistranscribed and every threshold above is meaningless.
    const simpleEs = readability(
      "La leche se ha acabado. Hay que comprar más.",
      "es",
    );
    const denseEs = readability(
      "La reconciliación automatizada de discrepancias inventariales requiere parametrización previa.",
      "es",
    );
    expect(simpleEs.score).toBeGreaterThan(denseEs.score);

    const simpleEn = readability("The milk has run out. Buy more.", "en");
    const denseEn = readability(
      "Automated reconciliation of inventory discrepancies necessitates prior parameterisation.",
      "en",
    );
    expect(simpleEn.score).toBeGreaterThan(denseEn.score);
  });

  it("names the INFLESZ band a Spanish score falls in", () => {
    expect(infleszBand(85)).toBe("muy fácil");
    expect(infleszBand(69)).toBe("fácil");
    expect(infleszBand(57)).toBe("normal");
    expect(infleszBand(45)).toBe("algo difícil");
    expect(infleszBand(20)).toBe("muy difícil");
  });

  it("treats an empty string as readable rather than dividing by zero", () => {
    expect(readability("", "es").score).toBe(100);
    expect(readability("{count}", "en").words).toBe(0);
  });
});
