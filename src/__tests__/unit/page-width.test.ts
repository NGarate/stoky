import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every dashboard screen says how wide it is, and draws its top the same way.
 *
 * The layout gives each of them `mx-auto max-w-7xl p-4` and then each screen
 * narrows within it. Three did not: `/prices` and `/shopping/lists` had no
 * bound at all, so on a wide monitor they ran the full 7xl while
 * `/inventory` and `/products` beside them stopped at 6xl — the same list of
 * things, two line lengths, depending which you opened. `/receipts` had a
 * bound *and* a second `p-6` on top of the layout's padding, so it was both
 * narrower and more inset than anything else.
 *
 * The width now comes from the kind of screen — `PageShell`'s `width` — and
 * the title from `PageHeader`, so the checks below are that each screen goes
 * through those two rather than restating what they decide.
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

/** The screens that render something — a route that only redirects has no box. */
function rendering(): Array<{ path: string; name: string; source: string }> {
  return screens(DASHBOARD)
    .map((path) => ({
      path,
      name: relative(DASHBOARD, path),
      source: readFileSync(path, "utf8"),
    }))
    .filter(({ source }) => !source.includes("permanentRedirect"));
}

/**
 * Screens not yet held to the shared header. These four hand-roll their
 * loading and failure states, each with an `<h1>` of its own; they adopt
 * `RouteState` and `PageHeader` together. The list only shrinks.
 */
const PENDING = new Set([
  "products/[id]/page.tsx",
  "products/[id]/adjust/page.tsx",
  "products/[id]/history/page.tsx",
  "receipts/[id]/applied/page.tsx",
]);

describe("a dashboard screen states its width", () => {
  it("finds the screens, so the checks below are not vacuous", () => {
    expect(screens(DASHBOARD).length).toBeGreaterThan(10);
  });

  it("leaves none of them to fill whatever it is given", () => {
    const unbounded = rendering()
      .filter(
        ({ source }) =>
          !/max-w-[0-9a-z]+/.test(source) && !/<PageShell[^>]*width=/.test(source),
      )
      .map(({ name }) => name);

    // If this is red: wrap the screen in `PageShell` with the width of its
    // kind — `index` for a list of things, `form` for a column read on a
    // phone, `detail` for one thing, `screen` for an overview.
    expect(unbounded).toEqual([]);
  });

  it("adds no gutter of its own to the layout's", () => {
    // A second `p-6` on a screen cost 48px of a 390px phone (ISSUES UI-5)
    // and made that screen more inset than every neighbour. The bound box is
    // the one that must not pad: `mx-auto` with any `p-N` beside it.
    const padded = rendering()
      .filter(({ source }) =>
        [...source.matchAll(/className="([^"]*)"/g)].some(
          ([, classes]) =>
            /(^|\s)mx-auto(\s|$)/.test(classes as string) &&
            /(^|\s)p-\d+(\s|$)/.test(classes as string),
        ),
      )
      .map(({ name }) => name);

    expect(padded).toEqual([]);
  });
});

describe("a dashboard screen draws its top through PageHeader", () => {
  it("writes no h1 of its own", () => {
    // Five arrangements of back link, title and actions, and two title
    // sizes, came from every screen writing its own. `PageHeader` holds the
    // one arrangement and the one size; a hand-written `<h1>` is a sixth.
    const own = rendering()
      .filter(({ name }) => !PENDING.has(name))
      .filter(({ source }) => /<h1[\s>]/.test(source))
      .map(({ name }) => name);

    expect(own).toEqual([]);
  });

  it("draws the header it is held to", () => {
    const headerless = rendering()
      .filter(({ name }) => !PENDING.has(name))
      .filter(({ source }) => !source.includes("<PageHeader"))
      .map(({ name }) => name);

    expect(headerless).toEqual([]);
  });
});
