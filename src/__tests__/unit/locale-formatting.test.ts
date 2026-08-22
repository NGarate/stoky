import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A date is written the way the reader writes dates, never the way the
 * browser does.
 *
 * `toLocaleDateString()` with no argument asks the *runtime* what locale it
 * is, which on a device set to English gives "1/5/2026" — inside a Spanish
 * interface, next to "1,19 €" formatted from the application's own locale.
 * The price screen's trends table did exactly that, in two places, with
 * `locale` already in scope three lines below for the money.
 *
 * The locale this application means is `useLocale()` on the client and the
 * request locale on the server; `Intl` cannot guess it. So the argument is
 * never optional here, and this is a scan rather than a rendering test
 * because the mistake is one keystroke wide and can reappear on any screen
 * that shows a date.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(ROOT, "src");

/** `toLocaleDateString()`, `toLocaleTimeString()`, `toLocaleString()`. */
const BARE = /\.toLocale(?:Date|Time)?String\(\s*\)/;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.includes("__tests__")) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

describe("dates are written in the reader's language", () => {
  it("scans something, so the check below is not vacuous", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);
  });

  it("never asks the runtime what locale it is", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => BARE.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

    // If this is red: pass the locale. `useLocale()` from next-intl on the
    // client, and `formatMoney`'s sibling shape on the server.
    expect(offenders).toEqual([]);
  });

  it("would notice one", () => {
    expect(BARE.test("new Date(x).toLocaleDateString()")).toBe(true);
    expect(BARE.test("new Date(x).toLocaleDateString(locale)")).toBe(false);
    expect(BARE.test('new Date(x).toLocaleDateString("es")')).toBe(false);
  });
});
