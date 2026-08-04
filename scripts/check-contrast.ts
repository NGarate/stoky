/**
 * WCAG AAA contrast audit for the design-lab proposals.
 *
 * Run: bun scripts/check-contrast.ts [--verbose]
 *
 * Reads the same token module the pages render from, so the audit always
 * measures what is actually shipped. Fails the process if any declared
 * foreground/background pair misses its threshold:
 *
 *   AAA body text (1.4.6)  7.0:1
 *   AAA large text (1.4.6) 4.5:1   (>=24px, or >=18.66px bold)
 *
 * Non-text contrast (1.4.11, 3:1) is checked separately for borders and the
 * gauge fill, which carry meaning in several of the proposals.
 */
import { DESIGNS, type Design, type Theme } from "../src/app/design/_lib/tokens";

const THRESHOLD = { body: 7, large: 4.5, nonText: 3 } as const;

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
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

interface Failure {
  design: string;
  theme: string;
  label: string;
  ratio: number;
  required: number;
  where: string;
}

const verbose = process.argv.includes("--verbose");
const failures: Failure[] = [];
let checks = 0;

function token(theme: Theme, name: string, design: Design, mode: string): string {
  const value = theme.tokens[name];
  if (!value) {
    throw new Error(`${design.slug}/${mode}: token "${name}" is not defined`);
  }
  return value;
}

for (const design of DESIGNS) {
  for (const [mode, theme] of [
    ["light", design.light],
    ["dark", design.dark],
  ] as const) {
    // Declared text pairs.
    for (const pair of theme.pairs) {
      const fg = token(theme, pair.fg, design, mode);
      const bg = token(theme, pair.bg, design, mode);
      const ratio = contrastRatio(fg, bg);
      const required = THRESHOLD[pair.scale];
      checks++;
      const ok = ratio >= required;
      if (!ok) {
        failures.push({
          design: design.slug,
          theme: mode,
          label: `${pair.fg} on ${pair.bg}`,
          ratio,
          required,
          where: pair.where,
        });
      }
      if (verbose) {
        console.log(
          `${ok ? "ok  " : "FAIL"} ${design.slug}/${mode} ${pair.fg} on ${pair.bg} ` +
            `= ${ratio.toFixed(2)}:1 (needs ${required}:1) — ${pair.where}`,
        );
      }
    }

    // Non-text contrast: interactive borders and the gauge fill both carry
    // meaning, so they must clear 3:1 against the surface behind them.
    for (const [fgName, bgName, where] of [
      ["border", "surface", "input and control borders"],
      ["border", "bg", "control borders on page background"],
      ["gauge", "gaugeTrack", "stock gauge fill against its track"],
    ] as const) {
      const ratio = contrastRatio(
        token(theme, fgName, design, mode),
        token(theme, bgName, design, mode),
      );
      checks++;
      const ok = ratio >= THRESHOLD.nonText;
      if (!ok) {
        failures.push({
          design: design.slug,
          theme: mode,
          label: `${fgName} on ${bgName}`,
          ratio,
          required: THRESHOLD.nonText,
          where,
        });
      }
      if (verbose) {
        console.log(
          `${ok ? "ok  " : "FAIL"} ${design.slug}/${mode} ${fgName} on ${bgName} ` +
            `= ${ratio.toFixed(2)}:1 (needs ${THRESHOLD.nonText}:1) — ${where}`,
        );
      }
    }
  }
}

console.log(
  `\n${checks} contrast checks across ${DESIGNS.length} designs × 2 themes.`,
);

if (failures.length === 0) {
  console.log("All pairs meet WCAG AAA.");
  process.exit(0);
}

console.error(`\n${failures.length} failing pair(s):\n`);
for (const f of failures) {
  console.error(
    `  ${f.design}/${f.theme}  ${f.label}  ${f.ratio.toFixed(2)}:1 ` +
      `(needs ${f.required}:1)  — ${f.where}`,
  );
}
process.exit(1);
