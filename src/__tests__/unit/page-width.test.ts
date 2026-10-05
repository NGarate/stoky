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
 * Which screens are held to the shared header. Index screens first; the
 * sub-pages join as they adopt it, and when every screen has, this list is
 * replaced by all of them.
 */
const HEADED = new Set([
  "inventory/page.tsx",
  "products/page.tsx",
  "prices/page.tsx",
  "receipts/page.tsx",
  "shopping/lists/page.tsx",
  "settings/page.tsx",
  "settings/stores/page.tsx",
  "settings/locations/page.tsx",
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
});

describe("a dashboard screen draws its top through PageHeader", () => {
  it("writes no h1 of its own", () => {
    // Five arrangements of back link, title and actions, and two title
    // sizes, came from every screen writing its own. `PageHeader` holds the
    // one arrangement and the one size; a hand-written `<h1>` is a sixth.
    const own = rendering()
      .filter(({ name }) => HEADED.has(name))
      .filter(({ source }) => /<h1[\s>]/.test(source))
      .map(({ name }) => name);

    expect(own).toEqual([]);
  });

  it("draws the header it is held to", () => {
    const headerless = rendering()
      .filter(({ name }) => HEADED.has(name))
      .filter(({ source }) => !source.includes("<PageHeader"))
      .map(({ name }) => name);

    expect(headerless).toEqual([]);
  });
});
