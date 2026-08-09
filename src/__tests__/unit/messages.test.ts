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
