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
    // `key:` is a common property name — an HTTP header in `proxy.ts`, a
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

/**
 * And the other direction: every key in the catalogue is asked for.
 *
 * Nothing ever removed a string. On 2026-10-06 the catalogues held 94 keys no
 * screen could render — a whole `errors` namespace from before `RouteState`, a
 * `confirmations` block nobody called, `common.success`, `common.optional` —
 * each one translated twice, offered to every future search for "which string
 * says this", and kept in step by `messages.test.ts` for nothing. A dead key
 * is also how copy goes stale: the live string gets edited and the dead twin
 * that grep finds first does not.
 *
 * A key counts as used when any of these finds it:
 *
 * - a `t("…")` call, resolved against its translator's namespace (the scan
 *   above);
 * - a `key: "…"` literal, the snackbar and op-label shape (the scan above);
 * - its full dotted path as a string literal anywhere — tables such as
 *   `ROUTE_TITLES` hold keys as data;
 * - its last segment as a string literal in a file whose translator has the
 *   key's namespace — the maps from a state to its key, `REASON_KEY` and
 *   `serverErrorKey` and their kind, which feed `t(variable)`;
 * - a prefix in `DYNAMIC_PREFIXES`: keys composed at runtime from a value
 *   (`receipts.status.${status}`), which no static scan can see. Each entry
 *   names where it is composed, so it can be checked when it stops being true.
 */
const DYNAMIC_PREFIXES: Record<string, string> = {
  // `ReceiptStatus` and the applied summary: statusLabel(status.toLowerCase()).
  "receipts.status.": "src/components/receipt/ReceiptStatus.tsx",
  // The ladder: t(`steps.${step}`).
  "receipts.steps.": "src/components/receipt/ReceiptStatus.tsx",
  // The people page: t(`role${role}`) and t(`role${role}Hint`).
  "household.role": "src/app/(dashboard)/settings/people/page.tsx",
  // A session's name, in the devices list and a member's sessions:
  // t(`screen${session.screen}`).
  "security.screen": "src/components/session/session-name.ts",
  // The stock history: t(`op${entry.operationType}`).
  "products.history.op": "src/app/(dashboard)/products/[id]/history/page.tsx",
};

function literalsIn(file: string): Set<string> {
  const source = readFileSync(file, "utf8");
  return new Set(
    [...source.matchAll(/["'`]([A-Za-z][\w.]*)["'`]/g)].map(
      (match) => match[1] as string,
    ),
  );
}

function catalogueKeys(node: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? catalogueKeys(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("the keys the catalogue holds", () => {
  const files = sourceFiles(SOURCE_ROOT);
  const called = new Set(ALL_USAGES.map((usage) => usage.key));
  const everyLiteral = new Set<string>();
  /** namespace → literals written in files that translate in it. */
  const byNamespace = new Map<string, Set<string>>();

  /** Literals in files with no translator of their own. */
  const untranslatedLiterals = new Set<string>();

  for (const file of files) {
    const literals = literalsIn(file);
    for (const literal of literals) everyLiteral.add(literal);
    const source = readFileSync(file, "utf8");
    if (translatorsIn(source).size === 0) {
      for (const literal of literals) untranslatedLiterals.add(literal);
    }
    for (const namespace of translatorsIn(source).values()) {
      const bucket = byNamespace.get(namespace) ?? new Set<string>();
      for (const literal of literals) bucket.add(literal);
      byNamespace.set(namespace, bucket);
    }
  }

  function used(key: string): boolean {
    if (called.has(key) || everyLiteral.has(key)) return true;
    if (Object.keys(DYNAMIC_PREFIXES).some((prefix) => key.startsWith(prefix))) {
      return true;
    }
    const cut = key.lastIndexOf(".");
    const namespace = key.slice(0, cut);
    const last = key.slice(cut + 1);
    if (byNamespace.get(namespace)?.has(last)) return true;
    // The key's last segment written as data in a file that does not translate
    // — `navigation.ts`'s `labelKey: "scan"`, `getAuthErrorKey`'s return
    // values — and read through `t(variable)` elsewhere. Loose on purpose: a
    // false "used" leaves one dead key standing; a false "unused" would fail
    // correct code.
    return untranslatedLiterals.has(last) && byNamespace.has(namespace);
  }

  it("are all asked for somewhere", () => {
    const unused = catalogueKeys(es as Record<string, unknown>).filter(
      (key) => !used(key),
    );

    expect(unused).toEqual([]);
  });

  it("would notice one that is not", () => {
    // Without this, a scan that matched everything would pass for ever.
    expect(used("common.thisKeyIsNotInAnyFile")).toBe(false);
  });

  it("names a real file for every dynamic prefix", () => {
    const missing = Object.values(DYNAMIC_PREFIXES).filter(
      (path) => !files.some((file) => file.endsWith(path.replace(/^src\//, ""))),
    );
    expect(missing).toEqual([]);
  });
});
