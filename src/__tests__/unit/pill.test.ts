import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `<Badge>` is the only pill.
 *
 * Seven were written separately before `badge.tsx` existed, in four sizes and
 * two roundings, and four survived the sweep that was meant to end them: the
 * receipt status chip and the three in `BestPriceIndicator`. Each carried its
 * own fill and its own foreground, so each was a colour pair the contrast
 * audit measured only by coincidence — the tokens happened to be ones already
 * on the list.
 *
 * The shape a pill has and nothing else does is a full rounding with
 * horizontal padding. A progress bar is `rounded-full` with a height and no
 * `px-`; an icon button is `rounded-full p-2`. Both are left alone, which is
 * why the check looks for the two together rather than for `rounded-full`.
 *
 * Comments are stripped first. This file's own siblings have been caught by
 * that before: a scan that reads prose as markup reports green — or, here,
 * red — for the wrong reason, and the paragraph above contains the very
 * string it bans.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(ROOT, "src");
const DESIGN_SYSTEM = join(SRC, "components", "ui");

function markupOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.startsWith(DESIGN_SYSTEM)) continue;
    if (path.includes("__tests__")) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/** A class list that is fully rounded *and* horizontally padded. */
function looksLikeAPill(source: string): boolean {
  return markupOnly(source)
    .split("\n")
    .some((line) => /rounded-full/.test(line) && /\bpx-/.test(line));
}

describe("the only pill is Badge", () => {
  it("scans something, so the check below is not vacuous", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(40);
  });

  it("finds no pill written by hand outside the design system", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => looksLikeAPill(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

    // If this is red: use `<Badge tone=… variant=…>`. If what you are
    // building is not a state — "auto-generated", "best price" — the tone is
    // `neutral`; `ok`, `warn` and `danger` are reserved.
    expect(offenders).toEqual([]);
  });

  it("would notice one, and leaves the things that are not pills alone", () => {
    expect(looksLikeAPill('<span className="rounded-full bg-ok px-2 py-1" />')).toBe(true);
    // A progress bar and an icon button, which are not pills.
    expect(looksLikeAPill('<div className="h-2 rounded-full bg-gauge" />')).toBe(false);
    expect(looksLikeAPill('<button className="rounded-full p-2" />')).toBe(false);
    // And prose describing one.
    expect(looksLikeAPill('  // it was rounded-full px-3 py-1.5 before')).toBe(false);
  });
});
