/**
 * Guards Phase 2's acceptance criterion: no component references a token that
 * does not exist.
 *
 * `src/app/globals.css` declares the palette and exposes it through Tailwind's
 * `@theme inline` block. A utility such as `bg-primary` only produces CSS if
 * `--color-primary` is declared there; when it is not, the class lands in the
 * markup and paints nothing — which is exactly how the login button came to
 * render with layout and no colour. A test is the only thing that notices,
 * because both the broken and the working version type-check and render.
 */
import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(ROOT, "src");
const GLOBALS = join(SRC, "app", "globals.css");

/** Utility prefixes that take a colour. */
const COLOUR_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "outline",
  "fill",
  "stroke",
  "placeholder",
  "caret",
  "accent",
  "divide",
  "shadow",
  "from",
  "via",
  "to",
];

/**
 * Root names owned by this design system. Anything built on one of these must
 * resolve; Tailwind's own palette (`gray-300`, `blue-500`) and its non-colour
 * utilities (`text-sm`, `border-2`) are deliberately out of scope.
 */
const OWNED = [
  "background",
  "foreground",
  "heading",
  "card",
  "muted",
  "primary",
  "secondary",
  "accent",
  "destructive",
  "input",
  "ring",
  "ok",
  "warn",
  "danger",
  "gauge",
  "snackbar",
  "chart",
  // Names a shadcn-shaped component might reach for that this system does not
  // declare. Listing them means the test fails loudly rather than silently.
  "popover",
  "sidebar",
];

function themeTokens(): Set<string> {
  const css = readFileSync(GLOBALS, "utf8");
  const start = css.indexOf("{", css.search(/@theme\s+inline\s*\{/));
  let depth = 0;
  let end = start;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = css.slice(start, end);
  return new Set(
    [...body.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map(([, name]) => name!),
  );
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    // The design lab carries its own scoped palette and is removed separately.
    if (path.includes(join("app", "design"))) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(path);
  }
  return acc;
}

const OWNED_PATTERN = new RegExp(
  `(?:^|["'\\s:\`])(?:${COLOUR_PREFIXES.join("|")})-((?:${OWNED.join("|")})(?:-[a-z]+)*)(?:/\\d+)?(?=["'\\s\`]|$)`,
  "gm",
);

describe("design tokens", () => {
  const tokens = themeTokens();

  it("declares the palette through @theme inline", () => {
    expect(tokens.size).toBeGreaterThan(0);
    expect(tokens.has("primary")).toBe(true);
    expect(tokens.has("ring")).toBe(true);
  });

  // The two families this phase adds. `check-contrast.ts` measures whether
  // their values are legible; this measures whether a component can name
  // them at all, which is the failure that renders as no colour rather than
  // as bad colour.
  it("exposes the snackbar's inverse surface as utilities", () => {
    expect(tokens.has("snackbar")).toBe(true);
    expect(tokens.has("snackbar-foreground")).toBe(true);
    expect(tokens.has("snackbar-action")).toBe(true);
  });

  it("exposes the chart's emphasis pair as utilities", () => {
    expect(tokens.has("chart-emphasis")).toBe(true);
    expect(tokens.has("chart-muted")).toBe(true);
  });

  it("resolves every design-system colour utility used in src/", () => {
    const missing: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const contents = readFileSync(file, "utf8");
      for (const [, name] of contents.matchAll(OWNED_PATTERN)) {
        if (!tokens.has(name!)) {
          missing.push(`${file.slice(ROOT.length + 1)}: --color-${name}`);
        }
      }
    }

    expect([...new Set(missing)]).toEqual([]);
  });
});
