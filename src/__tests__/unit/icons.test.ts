import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * One icon convention: lucide, hidden from assistive technology.
 *
 * Three dialogs closed on a "✕" character, six controls drew hand-written
 * `<svg>` paths for glyphs lucide already ships (a chevron, a magnifier, a
 * scan frame, a plus and a minus), and a handful of lucide icons inside
 * buttons were announced alongside the label they decorate. The words carry
 * the meaning here; an icon is never the only name of anything.
 */
const SRC = join(import.meta.dir, "..", "..");

/** Hand-drawn SVG that is still the right answer, and why. */
const SVG_ALLOWED: Record<string, string> = {
  "components/barcode/Scanner.tsx":
    "the torch toggle's two states carry a <title> each and are what its tests address",
  "components/security/TotpQr.tsx":
    "a QR code is not a glyph: it is drawn from the data it encodes, and named with role=img",
};

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.includes("__tests__")) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/** Comments out, so prose that names a glyph is not read as markup. */
function markupOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path),
  source: markupOnly(readFileSync(path, "utf8")),
}));

describe("icons", () => {
  it("scans something, so the checks below are not vacuous", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(
      files.some(({ source }) => source.includes('from "lucide-react"')),
    ).toBe(true);
  });

  it("closes things with lucide's X, not a ✕ character", () => {
    expect(
      files
        .filter(({ source }) => source.includes("✕"))
        .map(({ path }) => path),
    ).toEqual([]);
  });

  it("does not hand-draw a glyph lucide already has", () => {
    const drawn = files
      .filter(({ source }) => /<svg\b/.test(source))
      .map(({ path }) => path)
      .filter((path) => !(path in SVG_ALLOWED));

    expect(drawn).toEqual([]);
  });

  it("hides every lucide icon from assistive technology", () => {
    const unhidden: string[] = [];
    for (const { path, source } of files) {
      const imported = /import \{([^}]*)\} from "lucide-react"/.exec(source);
      if (!imported) continue;
      for (const name of imported[1]!
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)) {
        for (const use of source.matchAll(
          new RegExp(`<${name}\\b([^>]*)>`, "g"),
        )) {
          if (!/aria-hidden="true"/.test(use[1]!))
            unhidden.push(`${path}: <${name}>`);
        }
      }
    }

    expect(unhidden).toEqual([]);
  });
});
