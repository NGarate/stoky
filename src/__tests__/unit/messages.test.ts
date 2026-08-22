import { describe, expect, test } from "bun:test";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";

/**
 * The two catalogues have to hold the same keys.
 *
 * next-intl does not throw on a missing key — it renders the key itself. So a
 * string added to `es.json` and forgotten in `en.json` does not fail a build, a
 * test or a page load; it puts `receipts.status.parsed` on screen for anyone
 * reading the app in English, and the only way anyone finds out is by switching
 * language and looking. That has already happened once in this project, on a
 * form field, where the leaked key became the field's accessible name.
 *
 * This is a unit test rather than part of the browser suite because it is a
 * property of two files, not of a rendered page: a route nobody visits in the
 * E2E suite can still carry the untranslated string.
 */

type Catalogue = { [key: string]: string | Catalogue };

function paths(node: Catalogue, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? paths(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

const spanish = paths(es as Catalogue);
const english = paths(en as Catalogue);

describe("message catalogues", () => {
  test("every Spanish key exists in English", () => {
    const missing = spanish.filter((key) => !english.includes(key));
    expect(missing).toEqual([]);
  });

  test("every English key exists in Spanish", () => {
    const missing = english.filter((key) => !spanish.includes(key));
    expect(missing).toEqual([]);
  });

  test("no value is left empty", () => {
    const empty = [
      ...paths(es as Catalogue).map((k) => ["es", k] as const),
      ...paths(en as Catalogue).map((k) => ["en", k] as const),
    ].filter(([catalogue, key]) => {
      const source = catalogue === "es" ? es : en;
      const value = key
        .split(".")
        .reduce<unknown>((node, part) => (node as Catalogue)?.[part], source);
      return typeof value !== "string" || value.trim() === "";
    });
    expect(empty).toEqual([]);
  });

  /**
   * A translation that is byte-identical to the Spanish is usually a copy that
   * nobody translated. Proper nouns and units legitimately match, so those are
   * listed rather than guessed at — an entry here is a claim that the word is
   * the same in both languages, not a way to silence the check.
   */
  test("no English string is an untranslated copy of the Spanish", () => {
    const SAME_IN_BOTH = new Set([
      "common.currency",
      "common.no",
      "products.new.unitPack",
      "settings.spanish",
      "settings.english",
    ]);

    const copied = spanish.filter((key) => {
      if (SAME_IN_BOTH.has(key)) return false;
      const read = (source: unknown) =>
        key.split(".").reduce<unknown>((n, p) => (n as Catalogue)?.[p], source);
      const a = read(es);
      const b = read(en);
      if (typeof a !== "string" || typeof b !== "string") return false;
      if (a !== b) return false;
      // A template made only of placeholders and punctuation — "{quantity}
      // {unit}", "{name} — {brand}" — has nothing in it to translate, so it is
      // identical in every language by construction.
      if (a.replace(/\{[^}]*\}/g, "").replace(/[\s·—–\-,.:;()]/g, "") === "") {
        return false;
      }
      // One word is too often a legitimate cognate ("Total", "Stock") to be
      // worth reporting; a whole sentence repeated is not.
      return a.trim().split(/\s+/).length > 1;
    });
    expect(copied).toEqual([]);
  });
});

/**
 * ISSUES.md I18N-2 — one word for one thing.
 *
 * The catalogue called the same piece of paper a *recibo* in `receipts.*` and a
 * *ticket* in `receipts.applied.*`, so the pipeline changed vocabulary at its
 * last step — the same class of seam as I18N-1, only subtler because both words
 * are Spanish and neither looks wrong on its own.
 *
 * "Ticket" won because `REDESIGN_PLAN.md` §3 says no system vocabulary and
 * writes for somebody standing in a supermarket: a Spanish supermarket hands
 * you a ticket, while a recibo is what a bank sends. It was the *larger* change
 * — twenty-three strings against nine — which is the direction the argument
 * pointed rather than the direction the diff did.
 */
describe("one word for one thing", () => {
  /** Terms that were split, and the word that won. */
  const RETIRED: [RegExp, string][] = [[/\brecibos?\b/i, "ticket"]];

  test("never uses a word the catalogue retired", () => {
    const offenders = spanish.filter((key) => {
      const value = key
        .split(".")
        .reduce<unknown>((node, part) => (node as Catalogue)?.[part], es);
      return (
        typeof value === "string" &&
        RETIRED.some(([pattern]) => pattern.test(value))
      );
    });

    expect(offenders).toEqual([]);
  });

  test("would notice one", () => {
    // Without this the check above passes for ever if `flatten` or the pattern
    // stops working, and a vocabulary test that cannot see the word it bans is
    // just a comment.
    expect(RETIRED[0][0].test("Subir recibo")).toBe(true);
    expect(RETIRED[0][0].test("Subir ticket")).toBe(false);
  });
});

/**
 * Arrows belong to the component, never to the string.
 *
 * `BackLink` draws an `aria-hidden` `<ArrowLeft/>`, and eight catalogue
 * entries opened with a literal "← ". The first two screens to adopt the
 * component therefore rendered **two** back arrows side by side — one drawn,
 * one typed — and no gate saw it: the strings were valid, the parity test
 * passed, and `tsc` has no opinion about the contents of a translation.
 *
 * A typed arrow is also worse than redundant on its own. Screen readers
 * announce "flecha hacia la izquierda" as part of the accessible name, which
 * is the noise `aria-hidden` exists to prevent (WCAG 2.4.9, DESIGN_AUDIT §4),
 * and a right-to-left locale would need the glyph flipped in every string
 * rather than once in a stylesheet.
 */
describe("decoration lives in components, not in the catalogue", () => {
  /**
   * Glyphs a component draws. None of them is ever part of a message.
   *
   * Not `«»`: those are Spanish quotation marks, which is typography the
   * catalogue is right to carry — forty-odd strings use them correctly.
   */
  const DRAWN = /[←→↑↓▲▼✓✔✕✖]/u;

  test("no catalogue string carries a glyph a component draws", () => {
    const offenders = [
      ...spanish.map((key) => [key, "es", value(es as Catalogue, key)] as const),
      ...english.map((key) => [key, "en", value(en as Catalogue, key)] as const),
    ]
      .filter(([, , text]) => typeof text === "string" && DRAWN.test(text))
      .map(([key, locale]) => `${locale}:${key}`);

    expect(offenders).toEqual([]);
  });

  test("would notice one", () => {
    expect(DRAWN.test("← Volver a productos")).toBe(true);
    expect(DRAWN.test("Volver a productos")).toBe(false);
    // Typography, not iconography: the em dash, the middot and the Spanish
    // quotation marks all stay.
    expect(DRAWN.test("2 lotes — 3 productos · «Leche»")).toBe(false);
  });
});

function value(node: Catalogue, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((current, part) => (current as Catalogue)?.[part], node);
}
