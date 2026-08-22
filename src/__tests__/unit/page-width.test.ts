import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every dashboard screen says how wide it is.
 *
 * The layout gives each of them `mx-auto max-w-7xl p-4` and then each screen
 * narrows within it. Three did not: `/prices` and `/shopping/lists` had no
 * bound at all, so on a wide monitor they ran the full 7xl while
 * `/inventory` and `/products` beside them stopped at 6xl — the same list of
 * things, two line lengths, depending which you opened. `/receipts` had a
 * bound *and* a second `p-6` on top of the layout's padding, so it was both
 * narrower and more inset than anything else.
 *
 * The check is that a width is *stated*, not which one. `/shopping` is a
 * phone-first column at 2xl and `/kitchen` is read from a metre away at 5xl;
 * both are decisions with reasons written down, and a rule that forced them
 * to agree would be worse than the drift it replaced. What is not a decision
 * is a screen that never says.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");
const DASHBOARD = join(ROOT, "src", "app", "(dashboard)");

/** Every `page.tsx` under the authenticated layout. */
function screens(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) screens(path, found);
    else if (entry === "page.tsx") found.push(path);
  }
  return found;
}

describe("a dashboard screen states its width", () => {
  it("finds the screens, so the check below is not vacuous", () => {
    expect(screens(DASHBOARD).length).toBeGreaterThan(10);
  });

  it("leaves none of them to fill whatever it is given", () => {
    const unbounded = screens(DASHBOARD)
      .map((path) => ({ path, source: readFileSync(path, "utf8") }))
      // A route that only redirects renders no box to bound.
      .filter(({ source }) => !source.includes("permanentRedirect"))
      .filter(({ source }) => !/max-w-[0-9a-z]+/.test(source))
      .map(({ path }) => relative(DASHBOARD, path));

    // If this is red: pick the width the screen's peers use — 6xl for a data
    // index, 2xl for a column read on a phone — and say so.
    expect(unbounded).toEqual([]);
  });
});
