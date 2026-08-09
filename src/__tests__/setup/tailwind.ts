import { readFileSync } from "node:fs";
import { compile } from "tailwindcss";

/**
 * Resolve a class list to the CSS a browser would actually apply — without one.
 *
 * The target-size floor is the defect this exists for. `button.tsx` and
 * `input.tsx` were `h-10` for the life of the project, which is 40px against a
 * 44px requirement, and nothing caught it: the component tests asserted
 * `toHaveClass("h-10")`, which is true of the broken version and the fixed one
 * alike. A class name is not a measurement.
 *
 * The usual answer is to measure in a real browser, and for composed layout it
 * is the only answer. But booting Chromium to find out how tall a button
 * declares itself is a poor trade — that question is decided by CSS alone, and
 * Tailwind will answer it directly. This runs its real compiler over the
 * project's real `globals.css`, so the theme, the `@theme` overrides and the
 * token values are the ones that ship.
 *
 * **What this cannot tell you**, and why the browser suite still exists: it
 * knows what an element *declares*, not what the layout *does*. A parent's
 * `overflow`, a `flex-shrink`, a fixed bar drawn over the top — none of those
 * are visible here. Those are measured in `e2e/`, on a handful of tests rather
 * than on every control.
 */

const STYLESHEET = "src/app/globals.css";

/**
 * A fresh compiler per call, deliberately.
 *
 * Tailwind's `build()` is incremental: it remembers every candidate it has been
 * given and returns the CSS for all of them. Reusing one compiler therefore
 * leaks earlier classes into later answers — asking for `h-10` after a `min-h-14`
 * returned 56px, and asking for `text-xs` after `text-sm` returned the `sm`
 * size. Both were caught by the guard test in `target-size.test.tsx`, which is
 * the reason that test exists: a resolver that quietly returns the wrong number
 * makes every assertion built on it green and meaningless.
 *
 * The stylesheet is read once; compiling costs a few milliseconds.
 */
const stylesheet = readFileSync(STYLESHEET, "utf8");

async function freshCompiler() {
  return compile(stylesheet, {
    base: process.cwd(),
    loadStylesheet: async (id, base) => {
      const path =
        id === "tailwindcss"
          ? "node_modules/tailwindcss/index.css"
          : id.replace(/^tailwindcss\//, "node_modules/tailwindcss/");
      return { path, base, content: readFileSync(path, "utf8") };
    },
  });
}

/**
 * Substitute custom properties, honouring fallbacks and nesting.
 *
 * Tailwind emits `line-height: var(--tw-leading, var(--text-sm--line-height))`.
 * The outer variable is set only when a `leading-*` utility is present, so on a
 * bare `text-sm` the answer lives entirely in the fallback. A substitution that
 * ignored fallbacks resolved that to the empty string and reported a line
 * spacing of zero — which the guard test caught before it could be believed.
 */
function substitute(value: string, variables: Map<string, string>): string {
  let out = value;
  for (let pass = 0; pass < 8; pass++) {
    const start = out.indexOf("var(");
    if (start === -1) return out;

    // Find this var()'s own closing bracket, since its fallback may contain one.
    let depth = 0;
    let end = -1;
    for (let i = start + 3; i < out.length; i++) {
      if (out[i] === "(") depth++;
      else if (out[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return out;

    const inner = out.slice(start + 4, end);
    const comma = inner.indexOf(",");
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? "" : inner.slice(comma + 1).trim();
    const resolved = variables.get(name) ?? fallback;

    out = out.slice(0, start) + resolved + out.slice(end + 1);
  }
  return out;
}

/** `calc(var(--spacing) * 10)` with `--spacing: 0.25rem` is 40px. */
function resolveLength(value: string, variables: Map<string, string>): number | undefined {
  const substituted = substitute(value, variables);

  const calc = substituted.match(/^calc\(([^)]+)\)$/);
  const expression = calc ? calc[1] : substituted;

  return evaluate(expression.trim());
}

/**
 * Multiplication and division only, left to right.
 *
 * That is the whole shape Tailwind emits — `calc(var(--spacing) * 10)` for a
 * size, `calc(1.5 / 1)` for the default line heights — and a general expression
 * evaluator here would be a second implementation of CSS to get wrong. Anything
 * more complicated returns undefined and the caller reports that it could not
 * resolve, which is the honest answer.
 */
function evaluate(expression: string): number | undefined {
  const tokens = expression.split(/\s*([*/])\s*/);
  let total = toPixels(tokens[0]?.trim() ?? "");
  if (total === undefined) return undefined;

  for (let i = 1; i < tokens.length; i += 2) {
    const operator = tokens[i];
    const operand = toPixels(tokens[i + 1]?.trim() ?? "");
    if (operand === undefined) return undefined;
    if (operator === "*") total *= operand;
    else if (operator === "/") {
      if (operand === 0) return undefined;
      total /= operand;
    } else return undefined;
  }
  return total;
}

function toPixels(token: string): number | undefined {
  const match = token.match(/^(-?[\d.]+)(px|rem|em)?$/);
  if (!match) return undefined;
  const amount = Number.parseFloat(match[1]);
  if (Number.isNaN(amount)) return undefined;
  // The root font size is the browser default; nothing in this project changes
  // it, and a test that assumed otherwise would be asserting a fiction.
  return match[2] === "rem" || match[2] === "em" ? amount * 16 : amount;
}

export interface ResolvedBox {
  /** Declarations as Tailwind emitted them, custom properties intact. */
  declarations: Map<string, string>;
  /** The same declarations with every `var()` substituted. */
  substituted: Map<string, string>;
  /** Computed in CSS pixels, where the value could be resolved to a length. */
  pixels: Map<string, number>;
}

/**
 * Compile a class list and return its declarations.
 *
 * Classes that Tailwind does not recognise are silently absent rather than an
 * error, which matters: a component's class string also carries `hover:`,
 * `focus-visible:` and arbitrary variants, and those are not the subject here.
 */
export async function resolve(classNames: string): Promise<ResolvedBox> {
  const built = await freshCompiler();
  const css = built.build(classNames.split(/\s+/).filter(Boolean));

  const variables = new Map<string, string>();
  for (const [, name, value] of css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) {
    if (!variables.has(name)) variables.set(name, value.trim());
  }

  const utilities = css.slice(css.indexOf("@layer utilities"));
  const declarations = new Map<string, string>();
  const substituted = new Map<string, string>();
  const pixels = new Map<string, number>();

  // Only the unprefixed rules: `.hover\:bg-x:hover` describes a state, not the
  // resting box, and folding it in would report a size the element never has.
  for (const [, selector, body] of utilities.matchAll(
    /\.([^{,\s]+)\s*\{([^}]*)\}/g,
  )) {
    if (selector.includes(":") && !selector.includes("\\:")) continue;
    for (const [, property, value] of body.matchAll(/([a-z-]+):\s*([^;]+);/gi)) {
      declarations.set(property, value.trim());
      substituted.set(property, substitute(value.trim(), variables));
      const px = resolveLength(value.trim(), variables);
      if (px !== undefined) pixels.set(property, px);
    }
  }

  return { declarations, substituted, pixels };
}

/**
 * The smallest height this class list guarantees, in CSS pixels.
 *
 * `min-height` wins over `height` because a control that wraps should grow
 * rather than clip — which is why the primitives use `min-h` — and because the
 * floor is the question being asked.
 */
export async function minimumHeight(classNames: string): Promise<number | undefined> {
  const { pixels } = await resolve(classNames);
  return pixels.get("min-height") ?? pixels.get("height");
}

/**
 * Line spacing as a multiple of the font size, which is the form WCAG 1.4.8
 * states its requirement in.
 *
 * A unitless `line-height` *is* the ratio — `1.5` means one and a half times the
 * font size, not one and a half pixels. Treating it as a length is how this
 * first reported the project's compliant `text-xs` as a ratio of 0.13, and it is
 * a mistake worth naming because the number looked plausible enough to file a
 * defect over.
 */
export async function lineHeightRatio(
  classNames: string,
): Promise<number | undefined> {
  const { substituted, pixels } = await resolve(classNames);
  const value = substituted.get("line-height");
  if (value === undefined) return undefined;

  // Unitlessness has to be judged after substitution: the declaration Tailwind
  // emits is `var(--tw-leading, var(--text-sm--line-height))`, which is all
  // letters, while what it resolves to is the bare number `1.5`.
  const bare = value.trim();
  const calc = bare.match(/^calc\((.+)\)$/);
  const inner = calc ? calc[1].trim() : bare;

  // Unitless, whether written plainly (`1.5`) or as the arithmetic Tailwind's
  // own defaults use (`calc(1.5 / 1)`). The unit test has to be applied to the
  // expression inside `calc()`, not to the whole string — "calc" is letters.
  if (!/[a-z%]/i.test(inner)) {
    return calc ? evaluate(inner) : Number.parseFloat(inner);
  }

  const fontSize = pixels.get("font-size");
  const resolved = pixels.get("line-height");
  if (!fontSize || resolved === undefined) return undefined;
  return resolved / fontSize;
}
