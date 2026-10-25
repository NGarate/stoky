import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A row that says it is a list item has to be inside a list.
 *
 * `ItemRow` renders an `<li>` unless told `as="div"`, which is right: nine
 * screens draw lists of things and a list is what they are. Eight of them
 * wrapped the rows in a `<ul>`. `/shopping/[id]` — the longest list in the
 * application, and the one read one-handed in a shop — wrapped them in a
 * `<div>`, so every row was an orphaned list item.
 *
 * That is not a nitpick about markup. An `<li>` outside a list container is
 * still `display: list-item`, so each row was drawn with a bullet; and the
 * accessibility tree loses the list, which is what tells a screen-reader user
 * "seven items" before reading the first one.
 *
 * **The scan follows the row to whoever draws it.** A first version looked
 * only for `<ItemRow` and so never opened the offending file at all — that
 * screen renders `<ShoppingItem>`, a component whose *own* file has the
 * `<ItemRow>` in it. A check that cannot fail against the defect it documents
 * is a comment. So a component that renders a row is itself treated as a row,
 * and its consumers carry the obligation.
 *
 * It is still a text scan: it proves a `<ul>` is in the file, not that the
 * rows are inside *that* one. `shopping-detail-states.test.tsx` asserts the
 * real parent in a real DOM. This one is here because it generalises to every
 * screen, including the next one nobody has written.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.includes("__tests__")) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/**
 * Source with its comments removed.
 *
 * Necessary, and found the hard way: the very comment explaining why the
 * shopping list needs a `<ul>` contains the characters `<ul>`, which satisfied
 * the check and made the gate blind to the file it was written for. A scan
 * that reads prose as if it were markup is worse than no scan — it reports
 * green for the wrong reason.
 */
function markupOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path),
  name: path.split("/").pop()?.replace(".tsx", "") ?? "",
  text: markupOnly(readFileSync(path, "utf8")),
}));

/**
 * Every component whose output is one `<li>` — `ItemRow`, plus anything that
 * renders one and is not itself a screen. Resolved transitively, because a
 * row wrapper can wrap a row wrapper.
 */
function rowComponents(): Set<string> {
  const rows = new Set(["ItemRow"]);
  for (let pass = 0; pass < 5; pass += 1) {
    for (const file of files) {
      if (file.path.startsWith("app/")) continue; // a screen is never a row
      if (rows.has(file.name)) continue;
      const rendersRow = [...rows].some((row) => file.text.includes(`<${row}`));
      // `as="div"` opts the row out of list semantics, and so does its wrapper.
      // A component that draws its rows inside its own `<ul>` is a list, not
      // a row — `DeviceList` is one — and it is checked as a drawer below.
      if (
        rendersRow &&
        !file.text.includes('as="div"') &&
        !/<ul[\s>]/.test(file.text)
      ) {
        rows.add(file.name);
      }
    }
  }
  return rows;
}

const ROWS = rowComponents();

/** Files that draw one or more rows they did not themselves become. */
const drawers = files.filter(
  (file) =>
    !ROWS.has(file.name) &&
    [...ROWS].some((row) => file.text.includes(`<${row}`)),
);

describe("rows that are list items live in lists", () => {
  it("finds the row components, so the check below is not vacuous", () => {
    expect([...ROWS]).toContain("ItemRow");
    expect([...ROWS]).toContain("ShoppingItem");
  });

  it("finds the screens that draw them", () => {
    expect(drawers.length).toBeGreaterThan(5);
    expect(drawers.map((file) => file.path)).toContain(
      "app/(dashboard)/shopping/[id]/page.tsx",
    );
  });

  it("gives every list-item row a list to belong to", () => {
    const orphans = drawers
      .filter((file) => {
        // A screen that opts every row out needs no list.
        const rows = [...ROWS].reduce(
          (count, row) =>
            count +
            (file.text.match(new RegExp(`<${row}[\\s>]`, "g")) ?? []).length,
          0,
        );
        const optedOut = (file.text.match(/as="div"/g) ?? []).length;
        if (optedOut >= rows) return false;
        return !/<ul[\s>]/.test(file.text);
      })
      .map((file) => file.path);

    // If this is red: wrap the rows in a `<ul>`, or pass `as="div"` when the
    // thing genuinely is not a list. Do not reach for `list-none`; that hides
    // the bullet and keeps the broken tree.
    expect(orphans).toEqual([]);
  });
});
