import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `mock.module` is process-global (D50): a `next/navigation` mock missing an
 * export takes it away from every file that runs after it, so a suite that
 * imports `redirect` fails to load, but only in a file order that puts it
 * there. CI's order did, twice: d69a8f1, and five mocks that left out
 * `redirect` in 2026-11. Locally both passed every run.
 */
const EXPORTS = [
  "useRouter",
  "useSearchParams",
  "usePathname",
  "useParams",
  "redirect",
];

const root = join(import.meta.dir, "..");
const files = [...new Bun.Glob("**/*.test.{ts,tsx}").scanSync(root)];

/** Each `mock.module("next/navigation", …)` call's text, up to its `}));`. */
function navigationMocks(source: string): string[] {
  return [
    ...source.matchAll(/mock\.module\(\s*"next\/navigation"[\s\S]*?\n\}\)\);/g),
  ].map(([text]) => text);
}

describe("every next/navigation mock", () => {
  it("is found in the suites that mock it", () => {
    expect(
      files.filter(
        (file) =>
          navigationMocks(readFileSync(join(root, file), "utf8")).length > 0,
      ).length,
    ).toBeGreaterThan(20);
  });

  for (const file of files) {
    const mocks = navigationMocks(readFileSync(join(root, file), "utf8"));
    if (mocks.length === 0) continue;
    it(`provides every export, in ${file}`, () => {
      for (const mock of mocks)
        for (const name of EXPORTS)
          expect(mock).toMatch(new RegExp(`\\b${name}\\s*:`));
    });
  }
});
