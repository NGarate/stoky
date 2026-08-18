/**
 * WCAG AAA contrast audit for the application's design tokens.
 *
 * Run: bun scripts/check-contrast.ts [--verbose]
 *
 * Reads `src/app/globals.css` — the file the application actually ships — and
 * asserts the thresholds below over the foreground/background pairs that
 * genuinely occur in the two screens and in the shared primitives:
 *
 *   AAA body text  (1.4.6)   7.0:1
 *   AAA large text (1.4.6)   4.5:1   (>=24px, or >=18.66px bold)
 *   Non-text       (1.4.11)  3.0:1   (control boundaries, focus ring, gauge)
 *
 * It parses the CSS rather than importing a TypeScript copy of the palette on
 * purpose (PROGRESS D12): an audit that measures a second copy of the numbers
 * is how a green check comes to mean nothing.
 *
 * Structural assertions, which fail the run just like a contrast miss:
 *   - light and dark declare exactly the same token names;
 *   - the two dark blocks (`[data-theme="dark"]` and the `prefers-color-scheme`
 *     media query) are byte-for-byte the same set, so they cannot drift;
 *   - every token is exposed through `@theme inline`, so adding a token
 *     without a Tailwind utility is caught here;
 *   - every `@theme inline` mapping points at a token that exists.
 *
 * Deliberately not checked: `--border`. It is a decorative hairline for
 * dividing content, not a control boundary, and 1.4.11 does not apply to
 * purely decorative rules. `--input` is the control boundary and is checked.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const THRESHOLD = { body: 7, large: 4.5, nonText: 3 } as const;
type Scale = keyof typeof THRESHOLD;

const CSS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "globals.css",
);

// --- colour maths -----------------------------------------------------------

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) throw new Error(`Expected 6-digit hex, got "${hex}"`);
  const [r, g, b] = [0, 2, 4].map((i) =>
    srgbToLinear(Number.parseInt(clean.slice(i, i + 2), 16)),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (l1 + 0.05) / (l2 + 0.05);
}

// --- CSS parsing ------------------------------------------------------------

/** Body of the first rule whose selector matches, with braces balanced. */
function ruleBody(css: string, selector: RegExp, label: string): string {
  const match = selector.exec(css);
  if (!match) throw new Error(`globals.css: no rule found for ${label}`);
  let depth = 0;
  const start = css.indexOf("{", match.index);
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start + 1, i);
    }
  }
  throw new Error(`globals.css: unbalanced braces in ${label}`);
}

/** `--name: #hex;` declarations, ignoring anything that is not a colour. */
function hexTokens(body: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(
    /--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g,
  )) {
    tokens[name!] = value!.toLowerCase();
  }
  return tokens;
}

/** `--color-x: var(--y);` mappings from the `@theme inline` block. */
function themeMappings(body: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [, utility, token] of body.matchAll(
    /--color-([a-z0-9-]+)\s*:\s*var\(\s*--([a-z0-9-]+)\s*\)\s*;/g,
  )) {
    map[utility!] = token!;
  }
  return map;
}

const css = readFileSync(CSS_PATH, "utf8");

const light = hexTokens(ruleBody(css, /:root\s*\{/, ":root (light)"));
const dark = hexTokens(
  ruleBody(css, /:root\[data-theme="dark"\]\s*\{/, ':root[data-theme="dark"]'),
);
const darkAuto = hexTokens(
  ruleBody(
    css,
    /:root:not\(\[data-theme="light"\]\)\s*\{/,
    "prefers-color-scheme: dark",
  ),
);
const mappings = themeMappings(
  ruleBody(css, /@theme\s+inline\s*\{/, "@theme inline"),
);

const structural: string[] = [];

if (Object.keys(light).length === 0) {
  structural.push("the light block declares no colour tokens");
}

for (const name of Object.keys(light)) {
  if (!(name in dark)) structural.push(`"${name}" is declared in light but not dark`);
}
for (const name of Object.keys(dark)) {
  if (!(name in light)) structural.push(`"${name}" is declared in dark but not light`);
}

for (const name of new Set([...Object.keys(dark), ...Object.keys(darkAuto)])) {
  if (dark[name] !== darkAuto[name]) {
    structural.push(
      `"${name}" differs between the two dark blocks: ` +
        `[data-theme="dark"] ${dark[name] ?? "(absent)"} vs ` +
        `prefers-color-scheme ${darkAuto[name] ?? "(absent)"}`,
    );
  }
}

for (const [utility, token] of Object.entries(mappings)) {
  if (!(token in light)) {
    structural.push(`@theme inline maps --color-${utility} to undefined --${token}`);
  }
}
const mapped = new Set(Object.values(mappings));
for (const name of Object.keys(light)) {
  if (!mapped.has(name)) {
    structural.push(`"${name}" has no --color-* utility in @theme inline`);
  }
}

// --- the pairs that actually occur -----------------------------------------

interface Pair {
  fg: string;
  bg: string;
  scale: Scale;
  where: string;
}

const PAIRS: Pair[] = [
  // Body copy.
  { fg: "foreground", bg: "background", scale: "body", where: "body copy on the page" },
  { fg: "foreground", bg: "card", scale: "body", where: "body copy on a card" },
  { fg: "foreground", bg: "muted", scale: "body", where: "body copy on the muted surface" },
  { fg: "card-foreground", bg: "card", scale: "body", where: "card body copy" },
  { fg: "muted-foreground", bg: "background", scale: "body", where: "secondary copy and input placeholders" },
  { fg: "muted-foreground", bg: "card", scale: "body", where: "secondary copy on a card" },
  { fg: "muted-foreground", bg: "muted", scale: "body", where: "secondary copy on the muted surface" },

  // The welcome panel on /login and /register (UI-10). It carries the ordinary
  // ink on its own surface, so the three pairs below are what it actually
  // renders — the panel introduces no foreground token of its own.
  { fg: "foreground", bg: "hero", scale: "body", where: "body copy on the welcome panel" },
  { fg: "muted-foreground", bg: "hero", scale: "body", where: "the panel's subtitle and wordmark" },

  // Controls.
  { fg: "primary-foreground", bg: "primary", scale: "body", where: "label on the primary button" },
  { fg: "secondary-foreground", bg: "secondary", scale: "body", where: "label on the secondary button" },
  { fg: "accent-foreground", bg: "accent", scale: "body", where: "label on a hovered ghost/outline button" },
  { fg: "destructive-foreground", bg: "destructive", scale: "body", where: "label on the destructive button" },
  { fg: "primary", bg: "background", scale: "body", where: "link-variant button and accent text" },
  { fg: "primary", bg: "card", scale: "body", where: "accent text on a card" },

  // States. Always accompanied by a word, never colour alone.
  { fg: "ok-foreground", bg: "ok", scale: "body", where: "healthy status pill" },
  { fg: "warn-foreground", bg: "warn", scale: "body", where: "low-stock status pill" },
  { fg: "danger-foreground", bg: "danger", scale: "body", where: "expiring / out-of-stock pill" },

  // Display type — the kitchen screen reads from a metre away.
  { fg: "heading", bg: "background", scale: "large", where: "page heading" },
  { fg: "heading", bg: "card", scale: "large", where: "card heading" },
  { fg: "heading", bg: "muted", scale: "large", where: "heading on the muted surface" },
  { fg: "heading", bg: "hero", scale: "large", where: "the welcome panel's heading" },

  // Non-text.
  { fg: "input", bg: "background", scale: "nonText", where: "control border on the page" },
  { fg: "input", bg: "card", scale: "nonText", where: "control border on a card" },
  { fg: "input", bg: "muted", scale: "nonText", where: "control border on the muted surface" },
  { fg: "ring", bg: "background", scale: "nonText", where: "focus outline against the page" },
  { fg: "ring", bg: "card", scale: "nonText", where: "focus outline against a card" },
  { fg: "ring", bg: "muted", scale: "nonText", where: "focus outline against the muted surface" },
  { fg: "destructive", bg: "background", scale: "nonText", where: "destructive button fill against the page" },
  { fg: "gauge", bg: "gauge-track", scale: "nonText", where: "stock gauge fill against its track" },
];

// --- run --------------------------------------------------------------------

interface Failure {
  theme: string;
  label: string;
  ratio: number;
  required: number;
  where: string;
}

const verbose = process.argv.includes("--verbose");
const failures: Failure[] = [];
let checks = 0;

function token(tokens: Record<string, string>, name: string, mode: string): string {
  const value = tokens[name];
  if (!value) throw new Error(`${mode}: token "--${name}" is not defined in globals.css`);
  return value;
}

if (structural.length === 0) {
  for (const [mode, tokens] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    for (const pair of PAIRS) {
      const ratio = contrastRatio(
        token(tokens, pair.fg, mode),
        token(tokens, pair.bg, mode),
      );
      const required = THRESHOLD[pair.scale];
      checks++;
      const ok = ratio >= required;
      if (!ok) {
        failures.push({
          theme: mode,
          label: `${pair.fg} on ${pair.bg}`,
          ratio,
          required,
          where: pair.where,
        });
      }
      if (verbose) {
        console.log(
          `${ok ? "ok  " : "FAIL"} ${mode} ${pair.fg} on ${pair.bg} ` +
            `= ${ratio.toFixed(2)}:1 (needs ${required}:1) — ${pair.where}`,
        );
      }
    }
  }
}

if (structural.length > 0) {
  console.error(`\n${structural.length} structural problem(s) in globals.css:\n`);
  for (const problem of structural) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `\n${checks} contrast checks over ${Object.keys(light).length} tokens × 2 themes, ` +
    `read from src/app/globals.css.`,
);

if (failures.length === 0) {
  console.log("All pairs meet WCAG AAA.");
  process.exit(0);
}

console.error(`\n${failures.length} failing pair(s):\n`);
for (const f of failures) {
  console.error(
    `  ${f.theme}  ${f.label}  ${f.ratio.toFixed(2)}:1 ` +
      `(needs ${f.required}:1)  — ${f.where}`,
  );
}
process.exit(1);
