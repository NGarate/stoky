/**
 * Reading level, measured.
 *
 * WCAG 2.1 **3.1.5 Reading Level** is AAA, and it is one of the few AAA
 * criteria a machine can decide at all — no tool automates it (pa11y's WCAG2AAA
 * standard emits "Check that…" and stops), so this project measures it itself,
 * the same way it measured target size rather than trusting a class name.
 *
 * It is not a compliance exercise. `REDESIGN_PLAN.md` states the premise as
 * "anyone in a household can use this, including people with limited technical
 * confidence". That sentence is this criterion, and until now nothing checked
 * it.
 *
 * **Two formulas, because the application ships in two languages and Flesch is
 * calibrated for English.** Applying an English formula to Spanish reports
 * Spanish as harder than it is: Spanish words carry more syllables at the same
 * difficulty. Fernández-Huerta is the Spanish adaptation, and INFLESZ is the
 * scale normally read with it.
 *
 * **What this cannot do.** A formula counts syllables and sentence lengths; it
 * does not know whether a word is jargon. "Trigrama de similitud" scores well
 * and means nothing to most people, and "Se ha guardado" scores worse and is
 * perfectly clear. So the number is a floor that catches the sentence nobody
 * read aloud, not a certificate — the same honest limit the axe suites carry.
 */

export interface ReadabilityScore {
  /** Fernández-Huerta (es) or Flesch Reading Ease (en). Higher is easier. */
  score: number;
  words: number;
  sentences: number;
  syllables: number;
}

export type SupportedLocale = "es" | "en";

/**
 * Strips what is not prose: ICU placeholders, tags, and the punctuation that
 * would otherwise be counted as a sentence ending.
 */
export function toProse(text: string): string {
  return (
    text
      // next-intl placeholders: {count}, {name, plural, ...}
      .replace(/\{[^}]*\}/g, " ")
      // Any markup that reached a catalogue string
      .replace(/<[^>]*>/g, " ")
      // Ellipses would otherwise read as three sentence endings
      .replace(/\.{2,}|…/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function countWords(prose: string): string[] {
  return prose.split(/[^\p{L}\p{N}'’-]+/u).filter((w) => w.length > 0);
}

function countSentences(prose: string): number {
  const endings = prose.match(/[.!?¿¡]+(?:\s|$)/g);
  // A label with no full stop is still one unit of reading, not zero.
  return Math.max(endings?.length ?? 0, 1);
}

/**
 * Syllables in a Spanish word.
 *
 * Spanish orthography is regular enough to count vowel groups: each group is
 * one syllable unless it is a hiatus. Two strong vowels (a, e, o) never form a
 * diphthong, and an accented weak vowel (í, ú) breaks one.
 */
export function countSpanishSyllables(word: string): number {
  const lower = word.toLowerCase();
  const STRONG = "aeoáéó";
  const ACCENTED_WEAK = "íú";
  const VOWEL = "aeiouáéíóúü";

  let syllables = 0;
  let index = 0;

  while (index < lower.length) {
    if (!VOWEL.includes(lower[index])) {
      index += 1;
      continue;
    }

    // Walk the whole run of adjacent vowels, splitting it where Spanish does.
    let run = "";
    while (index < lower.length && VOWEL.includes(lower[index])) {
      run += lower[index];
      index += 1;
    }

    syllables += 1;
    for (let i = 1; i < run.length; i++) {
      const previous = run[i - 1];
      const current = run[i];
      const bothStrong = STRONG.includes(previous) && STRONG.includes(current);
      const accentedWeak =
        ACCENTED_WEAK.includes(previous) || ACCENTED_WEAK.includes(current);
      if (bothStrong || accentedWeak) syllables += 1;
    }
  }

  return Math.max(syllables, 1);
}

/** Syllables in an English word, by the usual vowel-group heuristic. */
export function countEnglishSyllables(word: string): number {
  const lower = word.toLowerCase().replace(/[^a-z]/g, "");
  if (lower.length === 0) return 0;

  // A trailing silent "e" is not a syllable — "make" is one, not two.
  const trimmed = lower.replace(/e$/, "");
  const groups = trimmed.match(/[aeiouy]+/g);
  return Math.max(groups?.length ?? 0, 1);
}

/**
 * Scores a piece of text on the scale for its language.
 *
 * - **es** — Fernández-Huerta: `206.84 − 60·(syllables/words) − 1.02·(words/sentences)`
 * - **en** — Flesch Reading Ease: `206.835 − 84.6·(syllables/words) − 1.015·(words/sentences)`
 */
export function readability(
  text: string,
  locale: SupportedLocale,
): ReadabilityScore {
  const prose = toProse(text);
  const words = countWords(prose);
  const sentences = countSentences(prose);

  if (words.length === 0) {
    return { score: 100, words: 0, sentences: 0, syllables: 0 };
  }

  const counter =
    locale === "es" ? countSpanishSyllables : countEnglishSyllables;
  const syllables = words.reduce((total, word) => total + counter(word), 0);

  const syllablesPerWord = syllables / words.length;
  const wordsPerSentence = words.length / sentences;

  const score =
    locale === "es"
      ? 206.84 - 60 * syllablesPerWord - 1.02 * wordsPerSentence
      : 206.835 - 84.6 * syllablesPerWord - 1.015 * wordsPerSentence;

  return {
    score: Math.round(score * 10) / 10,
    words: words.length,
    sentences,
    syllables,
  };
}

/**
 * The INFLESZ band a Spanish score falls in — the scale Fernández-Huerta is
 * normally read with, and the one that makes a bare number mean something.
 */
export function infleszBand(score: number): string {
  if (score >= 80) return "muy fácil";
  if (score >= 65) return "fácil";
  if (score >= 55) return "normal";
  if (score >= 40) return "algo difícil";
  return "muy difícil";
}
