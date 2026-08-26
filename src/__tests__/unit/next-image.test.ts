import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Nothing imports `next/image`, and `next.config.ts` depends on that.
 *
 * Next's Image Optimization endpoint decodes with `sharp`, and the config
 * excludes `sharp` from the standalone output — 19 MB of native library for a
 * route this application has no way to reach. That saving is only correct
 * while the premise holds. The moment a component renders `next/image`,
 * `/_next/image` becomes reachable and would fail at runtime, in production,
 * on an image that renders perfectly in development.
 *
 * A build cannot notice: the trace exclusion is silent by design. So the
 * premise is asserted here instead.
 *
 * If this goes red, the choice is real and either answer is fine — drop the
 * `next/image` usage, or drop the exclusion and carry the library. What is
 * not fine is having one without the other.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.includes("__tests__")) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

describe("the image optimiser stays unreachable", () => {
  it("scans something, so the check below is not vacuous", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);
  });

  it("finds no import of next/image", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => /from\s+["']next\/image["']/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

    expect(offenders).toEqual([]);
  });
});
