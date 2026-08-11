import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * ISSUES.md I18N-3 — nowhere in the application decides the language on its own.
 *
 * `lib/utils` exported a `formatDate` with `es-ES` written into it. It is gone
 * rather than parameterised: nothing called it, and the receipts route had a
 * comment explaining that it *could not* call it, which is a helper that has
 * become a hazard. Deleting one function is not worth a test; stopping the next
 * one is.
 *
 * The check is the same shape as `message-usage.test.ts`: catch the class in
 * the cheapest tier there is, because the instance was found by reading rather
 * than by any suite. A pinned locale produces no error and no failing
 * assertion — it produces a Spanish date on an English page, which only a
 * person looking at the right screen in the right language ever notices.
 */

const SRC = join(import.meta.dir, "../..");

/**
 * A literal language tag passed as a formatter's first argument.
 *
 * Deliberately narrow. It matches `"es"`, `"en-GB"` and friends where a locale
 * belongs, and not the many other places a two-letter string appears — the
 * point is to catch the mistake, not to police every string in the codebase.
 */
const PINNED = new RegExp(
  String.raw`(?:toLocale(?:Date|Time)?String|Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat|Collator|PluralRules))\(\s*["'][a-z]{2}(?:-[A-Z]{2})?["']`,
);

/**
 * Where a pinned locale would be the correct answer.
 *
 * Empty, and worth keeping empty. A case could exist — something measuring a
 * specific language rather than displaying to a reader — and this is where it
 * would be written down, so that adding one is a decision somebody makes on
 * purpose rather than a line that quietly stops being checked.
 */
const DELIBERATE = new Set<string>();

function sourceFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;

    if (statSync(full).isDirectory()) {
      // The suite itself may pin a locale: asserting a formatted string
      // requires knowing which language it is in.
      if (entry === "__tests__") return [];
      return sourceFiles(full, relative);
    }

    return /\.tsx?$/.test(entry) ? [relative] : [];
  });
}

describe("nothing decides the language for the reader", () => {
  const files = sourceFiles(SRC);

  it("has files to check", () => {
    // Without this, a broken walk reports success over an empty list — which is
    // how a sweeping test quietly stops sweeping.
    expect(files.length).toBeGreaterThan(50);
  });

  it("formats dates and numbers in the reader's locale", () => {
    const pinned = files.filter((file) => {
      if (DELIBERATE.has(file)) return false;
      return PINNED.test(readFileSync(join(SRC, file), "utf8"));
    });

    expect(pinned).toEqual([]);
  });

  it("would notice one", () => {
    // The regex is the whole test, so it gets its own assertion rather than
    // being trusted. A pattern that matched nothing would make the check above
    // pass for ever.
    expect(PINNED.test(`new Date().toLocaleDateString("es-ES", {})`)).toBe(true);
    expect(PINNED.test(`new Intl.NumberFormat("en", {})`)).toBe(true);

    // And does not fire on the correct version.
    expect(PINNED.test(`new Intl.DateTimeFormat(locale, {})`)).toBe(false);
    expect(PINNED.test(`new Date().toLocaleDateString(locale)`)).toBe(false);
  });
});
