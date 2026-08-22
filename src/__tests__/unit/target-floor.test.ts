import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * DESIGN_AUDIT A5.3, closed.
 *
 * The audit's argument was arithmetic. `button.tsx` and `input.tsx` were
 * `h-10` — 40px against a 44px requirement — for the life of the project, and
 * `target-size.test.tsx` now resolves their floor through Tailwind's own
 * compiler so that cannot happen again. But it covered the two places that did
 * not need it and none of the 142 that did: every screen restated
 * `min-h-[48px]` by hand, so changing the floor would leave 142 call sites on
 * the old value.
 *
 * This is the other half. A floor written outside the design system is a floor
 * nothing keeps in step, so it has to be a decision somebody made rather than
 * a habit somebody had — which is what an allow-list with a reason per entry
 * is for.
 *
 * The list is meant to shrink. Adding to it is not forbidden, it is a
 * conversation: write the reason, and if the reason is "there is no primitive
 * for this yet", the answer is usually to build one — `Select`, `Textarea`
 * and `RadioOption` all came out of exactly that question.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(ROOT, "src");
const DESIGN_SYSTEM = join(SRC, "components", "ui");

const FLOOR = /min-h-\[(48|56|64)px\]/;

/**
 * Where a hand-written target floor is still the right answer, and why.
 *
 * Keyed by path, valued by the reason. The reason is the point: a path with
 * no explanation is indistinguishable from one nobody looked at.
 */
const ALLOWED: Record<string, string> = {
  "app/(dashboard)/inventory/add/page.tsx":
    "a <summary> disclosure — a native control the design system has no primitive for",
  "app/(dashboard)/inventory/consume/page.tsx":
    "a <summary> disclosure — as above",
  "components/products/ProductRating.tsx":
    "a <summary> disclosure — as above",
  "app/(dashboard)/receipts/upload/page.tsx":
    "sizing passed to StoreSelector, which should own its own geometry — a real loose end, not an exception",
  "app/(dashboard)/shopping/page.tsx":
    "Screen A's trolley disclosure: a full-width row read with a trolley in one hand (D54, REDESIGN_PLAN §3)",
  "app/offline/page.tsx":
    "the offline page is served without JavaScript and cannot import a component",
  "components/dashboard/CompactNav.tsx":
    "the phone bar and the tablet rail: a navigation destination is 56px and 76px by design, not a control (DESIGN_AUDIT A3.5)",
  "components/dashboard/DashboardNav.tsx":
    "the navigation owns its own geometry: a nav item is not a button and must not look like one",
  "components/dashboard/NavSheet.tsx":
    "as above — the sheet's close control belongs to the navigation",
  "components/inventory/LocationPicker.tsx":
    "a hand-built listbox, which exists because a hierarchy is not a flat <select> (documented in the file)",
  "components/inventory/ExpiringItems.tsx":
    "a row that is entirely a link, kept while that screen's shape is decided",
  "components/shopping/ShoppingItem.tsx":
    "the tick's <label>, which wraps a native checkbox rather than a control the system owns",
};

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

const offenders = sourceFiles(SRC)
  .filter((path) => FLOOR.test(readFileSync(path, "utf8")))
  .map((path) => relative(SRC, path));

describe("the 48px floor lives in the design system", () => {
  it("scans something, so the checks below are not vacuous", () => {
    // A wrong root would make every assertion pass while reading nothing.
    expect(sourceFiles(SRC).length).toBeGreaterThan(40);
  });

  it("is not restated by any screen that has not said why", () => {
    const unexplained = offenders.filter((path) => !(path in ALLOWED));

    // If this is red: use `Button`, `Input`, `Select`, `Textarea`,
    // `RadioOption` or `ItemRow`. If none of them fits, add the path above
    // with the reason — and consider whether the reason is really "this
    // needs a primitive".
    expect(unexplained).toEqual([]);
  });

  it("keeps no reason for a floor that is no longer there", () => {
    // The list shrinks by deletion, and an entry nobody removed is an
    // exception nobody re-examined.
    const stale = Object.keys(ALLOWED).filter((path) => !offenders.includes(path));

    expect(stale).toEqual([]);
  });

  it("has fewer of them than the audit counted", () => {
    // 142 when this phase began; A5.3 said the number kept rising.
    expect(offenders.length).toBeLessThan(20);
  });
});
