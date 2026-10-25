import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Five copies of one block is how this started. A component only helps if the
 * sixth copy cannot be written without something noticing.
 *
 * A source scan rather than a rendered test, for the same reason
 * `design-tokens.test.ts` is one: both the duplicated version and the shared
 * version type-check, render identically and pass every other assertion. The
 * difference is only visible in the source.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");
const APP = join(ROOT, "src", "app");

/**
 * The forms that refuse a submit. Five when this was written; the product
 * edit page has since been absorbed into the product itself, so its form
 * lives beside the page that owns it rather than on a route of its own.
 */
const PAGES = [
  join(APP, "(dashboard)/inventory/add/page.tsx"),
  join(APP, "(dashboard)/inventory/consume/page.tsx"),
  join(APP, "(dashboard)/products/new/page.tsx"),
  join(APP, "(dashboard)/products/[id]/adjust/page.tsx"),
  join(ROOT, "src", "components", "products", "ProductDetailsForm.tsx"),
];

/** The `<ul>` class string every one of the five hand-wrote. */
const HAND_WRITTEN = "list-disc space-y-1 pl-5";

function tsxFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) tsxFiles(path, found);
    else if (path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

describe("the form error summary", () => {
  const sources = PAGES.map((path) => ({
    path,
    text: readFileSync(path, "utf8"),
  }));

  it("finds every form, so the checks below are not vacuous", () => {
    // A path typo would make every assertion pass while reading nothing —
    // the same guard `message-usage.test.ts` carries.
    expect(sources).toHaveLength(5);
    for (const { path, text } of sources) {
      expect(text.length, `${path} read empty`).toBeGreaterThan(1000);
    }
  });

  it("is rendered by all of them, rather than written out again", () => {
    for (const { path, text } of sources) {
      expect(text, `${path} does not render FormErrorSummary`).toContain(
        "<FormErrorSummary",
      );
    }
  });

  it("is the only thing that draws one, anywhere under src/", () => {
    const owner = join(
      ROOT,
      "src",
      "components",
      "ui",
      "form-error-summary.tsx",
    );
    const offenders = tsxFiles(join(ROOT, "src"))
      .filter((path) => path !== owner)
      .filter((path) => readFileSync(path, "utf8").includes(HAND_WRITTEN));

    expect(offenders.map((path) => path.replace(ROOT, ""))).toEqual([]);
  });

  it("owns the only focusable alert in the application", () => {
    const owner = join(
      ROOT,
      "src",
      "components",
      "ui",
      "form-error-summary.tsx",
    );

    // Proximity rather than file membership: `products/[id]/page.tsx` holds a
    // `role="alert"` and a `tabIndex={-1}` in two unrelated elements, and a
    // per-file check calls that a second focusable alert. 200 characters is
    // wide enough to span the attributes of one JSX element and narrow enough
    // not to span two.
    const focusableAlert =
      /role="alert"[\s\S]{0,200}?tabIndex=\{-1\}|tabIndex=\{-1\}[\s\S]{0,200}?role="alert"/;

    const offenders = tsxFiles(join(ROOT, "src")).filter((path) =>
      focusableAlert.test(readFileSync(path, "utf8")),
    );

    // A second one would be a second thing competing for focus on a refusal,
    // and a conversation rather than a paste.
    expect(offenders).toEqual([owner]);
  });
});
