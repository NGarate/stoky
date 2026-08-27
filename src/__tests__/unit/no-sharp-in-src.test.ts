import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Nothing the server ships imports `sharp`, and `next.config.ts` depends on
 * that.
 *
 * The config excludes `sharp` and `@img/*` from the standalone output — 19 MB
 * of native library for a decoder the application stopped using when image
 * work moved to `Bun.Image`. The saving is only correct while nothing imports
 * it. The moment something in `src/` does, it works in development, passes
 * every gate, and fails in production with "Could not load the sharp module
 * using the linux-x64 runtime" — which is the exact error that made this
 * application leave `sharp` in the first place.
 *
 * **A build cannot notice**, because the trace exclusion is silent by design.
 * `next-image.test.ts` guards the sibling premise for the same reason and says
 * so in the same words; this is the half that had no guard
 * (`docs/superpowers/plans/2026-08-27-finishing-the-bun-migration.md` §1, the
 * only item there that closes a hole rather than tidying one).
 *
 * **The test suite may import it, and does.** `sharp` is a devDependency kept
 * for exactly that: three test files build image fixtures with it and read the
 * results back, which is how a defect in `Bun.Image` would show as the two
 * libraries disagreeing. `src/__tests__/` is therefore skipped rather than
 * exempted case by case.
 *
 * If this goes red, the choice is real and either answer is fine — drop the
 * import, or drop the exclusion and ship the library. What is not fine is
 * having one without the other.
 */

const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(ROOT, "src");

/**
 * An import of `sharp`, in each of the three ways it can be written.
 *
 * Deliberately not a search for the word. Two files in `src/` discuss `sharp`
 * in prose — `services/image.ts` explains why it is not used and
 * `validations/receipt.ts` records what its libvips could not decode — and a
 * guard that went red on an explanation would be deleted within the week.
 */
const IMPORTS_SHARP =
  /(?:from\s+["']sharp["'])|(?:require\(\s*["']sharp["']\s*\))|(?:import\(\s*["']sharp["']\s*\))/;

function shippedFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.includes("__tests__")) continue;
    if (statSync(path).isDirectory()) shippedFiles(path, found);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

describe("sharp stays out of what ships", () => {
  it("scans something, so the check below is not vacuous", () => {
    expect(shippedFiles(SRC).length).toBeGreaterThan(100);
  });

  it("finds no import of sharp outside the test suite", () => {
    const offenders = shippedFiles(SRC)
      .filter((path) => IMPORTS_SHARP.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

    expect(offenders).toEqual([]);
  });

  it("still recognises an import when it sees one", () => {
    // The pattern above is the whole guard, and a pattern that matches nothing
    // passes every assertion before it. Checked against the three shapes it has
    // to catch and the prose it must not.
    expect(IMPORTS_SHARP.test('import sharp from "sharp";')).toBe(true);
    expect(IMPORTS_SHARP.test("const sharp = require('sharp')")).toBe(true);
    expect(IMPORTS_SHARP.test('const s = await import("sharp");')).toBe(true);

    expect(IMPORTS_SHARP.test("// sharp's bundled libvips cannot decode HEIC")).toBe(
      false,
    );
    expect(IMPORTS_SHARP.test('import { x } from "sharpen";')).toBe(false);
  });
});

describe("the other half of the pair", () => {
  const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");

  it("still excludes sharp from the standalone output", () => {
    // Without this line the premise above is unnecessary — the library would
    // ship and an import would work. The two belong together, and this is the
    // assertion that says a change to one is a decision about the other.
    expect(config).toContain("outputFileTracingExcludes");
    expect(config).toContain("sharp");
    expect(config).toContain("@img");
  });

  it("keeps sharp a devDependency", () => {
    // In `dependencies` it would be installed into the production image and
    // then excluded from the artefact anyway — the cost with none of the point.
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(manifest.devDependencies?.sharp).toBeDefined();
    expect(manifest.dependencies?.sharp).toBeUndefined();
  });
});
