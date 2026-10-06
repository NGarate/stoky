import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Money is formatted in `src/lib/money.ts` and nowhere else.
 *
 * Three screens built their own `Intl.NumberFormat({ style: "currency" })`:
 * the applied-receipt page carried a private copy of `formatMoney`, and the
 * receipts list and the review card wrote `currency: "EUR"` as a literal
 * rather than `DEFAULT_CURRENCY`. A copy is how the "1.19 €" defect comes
 * back on one screen while the others stay fixed, and a literal is how the
 * default currency stops being one setting.
 */
const SRC = join(import.meta.dir, "..", "..");
const OWNER = join(SRC, "lib", "money.ts");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.includes("__tests__")) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

describe("money has one formatter", () => {
  it("scans something, so the check below is not vacuous", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(40);
    expect(readFileSync(OWNER, "utf8")).toMatch(/style:\s*"currency"/);
  });

  it("formats currency only in src/lib/money.ts", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => path !== OWNER)
      .filter((path) => /style:\s*["']currency["']/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

    // Use `formatMoney` / `formatUnitPrice`, with `DEFAULT_CURRENCY` when the
    // data carries no currency of its own.
    expect(offenders).toEqual([]);
  });
});
