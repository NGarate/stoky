import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import es from "../../../messages/es.json";
import en from "../../../messages/en.json";

/**
 * Every key a component asks for exists in the catalogues.
 *
 * `messages.test.ts` compares the two catalogues with each other, so it catches
 * a key present in one and missing from the other. It cannot see a key that is
 * **used in a component and absent from both** — which is exactly what
 * `ISSUES.md` I18N-5 is, and exactly what shipped on `/shopping/[id]`:
 * `t("shopping.items")` against a catalogue that only had `itemsCount`.
 *
 * next-intl throws `MISSING_MESSAGE` at render, so the only thing that had ever
 * found it was opening the page in a browser. That is a slow, unreliable way to
 * check a fact about source text.
 *
 * Dynamic keys are skipped rather than guessed at — `t(someVariable)` cannot be
 * resolved here, and pretending otherwise would either fail on correct code or
 * quietly pass on anything.
 *
 * **Snackbar messages are the exception that needed a second scan.** They are
 * not `t("…")` calls at the call site: the queue stores an op label as
 * `{ key, values }` and the provider is the only place that translates it
 * (`queue.ts:41-47` — a queue composed in Spanish and read after a language
 * switch would otherwise be half in each). To the regex above that is
 * `t(variable)`, so every snackbar key would have been skipped and a
 * misspelled one would have reached production announcing MISSING_MESSAGE.
 * `labelKeysIn` collects those literals, so the gate has no hole from the
 * moment it opens.
 */

const SOURCE_ROOT = join(import.meta.dir, "../..");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__") continue;
      sourceFiles(path, found);
    } else if (path.endsWith(".tsx") || path.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
}

/** `a.b.c` against the catalogue object. */
function has(catalogue: Record<string, unknown>, key: string): boolean {
  let current: unknown = catalogue;
  for (const part of key.split(".")) {
    if (typeof current !== "object" || current === null) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string";
}

interface Usage {
  file: string;
  key: string;
}

/**
 * Which translator variables exist in a file, and what namespace each carries.
 *
 * `const t = useTranslations("inventory")` and
 * `const offline = useTranslations("offline")` can both appear in one file, and
 * `useTranslations()` with no namespace means the key is already absolute.
 */
function translatorsIn(source: string): Map<string, string> {
  const translators = new Map<string, string>();
  const pattern =
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)")?\s*\)/g;

  for (const match of source.matchAll(pattern)) {
    translators.set(match[1] as string, match[2] ?? "");
  }
  return translators;
}

function usagesIn(file: string): Usage[] {
  const source = readFileSync(file, "utf8");
  const translators = translatorsIn(source);
  if (translators.size === 0) return [];

  const usages: Usage[] = [];

  for (const [name, namespace] of translators) {
    // `t("key")` and `t("key", { … })`, but never `t(variable)`.
    const calls = new RegExp(`\\b${name}\\(\\s*"([^"]+)"`, "g");
    for (const match of source.matchAll(calls)) {
      const key = match[1] as string;
      usages.push({ file, key: namespace ? `${namespace}.${key}` : key });
    }
  }

  return usages;
}

/**
 * Keys written as data rather than called: `message: { key: "offline.usedUp" }`
 * and the `label: { key: … }` every queued operation carries.
 *
 * Always absolute — there is no namespace at the point they are declared, and
 * the provider that renders them uses `useTranslations()` with none.
 */
function labelKeysIn(file: string): Usage[] {
  const source = readFileSync(file, "utf8");
  const pattern = /\bkey:\s*"([^"]+)"/g;

  return [...source.matchAll(pattern)]
    .map((match) => match[1] as string)
    // `key:` is a common property name — an HTTP header in `middleware.ts`, a
    // sentinel in `LocationPicker`. A catalogue key is always
    // `namespace.name`, dotted and camelCase, so that shape is the filter.
    // The cost of being wrong here is one direction only: a key this misses
    // is unguarded, never a false failure on correct code.
    .filter((key) => /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/.test(key))
    .map((key) => ({ file, key }));
}

const ALL_USAGES = sourceFiles(SOURCE_ROOT).flatMap((file) => [
  ...usagesIn(file),
  ...labelKeysIn(file),
]);

describe("the keys components actually ask for", () => {
  it("finds some, so the scan is not vacuous", () => {
    // If the regexes stopped matching, every assertion below would pass while
    // checking nothing at all.
    expect(ALL_USAGES.length).toBeGreaterThan(100);
  });

  it("sees the keys that are written as data, not called", () => {
    // The op labels and snackbar messages. Without this the second scan could
    // silently match nothing and the first assertion would not notice.
    expect(
      ALL_USAGES.some((usage) => usage.key.startsWith("offline.")),
    ).toBe(true);
  });

  it("all exist in the Spanish catalogue", () => {
    const missing = ALL_USAGES.filter(
      (usage) => !has(es as Record<string, unknown>, usage.key),
    ).map((usage) => `${usage.key} (${usage.file.replace(SOURCE_ROOT, "src")})`);

    // next-intl throws MISSING_MESSAGE at render, so before this the only
    // thing that found one was opening the page in a browser.
    expect(missing).toEqual([]);
  });

  it("all exist in the English catalogue", () => {
    const missing = ALL_USAGES.filter(
      (usage) => !has(en as Record<string, unknown>, usage.key),
    ).map((usage) => `${usage.key} (${usage.file.replace(SOURCE_ROOT, "src")})`);

    expect(missing).toEqual([]);
  });
});
