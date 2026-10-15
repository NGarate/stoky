import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { lineHeightRatio, minimumHeight, resolve } from "../setup/tailwind";

/**
 * WCAG 2.5.5 (AAA) target size, decided from CSS rather than from a browser.
 *
 * The defect this replaces: `button.tsx` and `input.tsx` were `h-10` — 40px
 * against a 44px requirement — for the life of the project, and every form
 * control in the application was under the floor. Nothing caught it. The
 * component tests asserted `toHaveClass("h-10")`, which is equally true of the
 * broken version and the fixed one, and happy-dom reports every rectangle as
 * 0×0 so no measurement was possible here.
 *
 * The resolution is not to measure in a browser — that is expensive and this
 * question does not need one. It is to render the component, take the class
 * string it actually produced, and put that through Tailwind's own compiler
 * against the project's own `globals.css`. What comes back is the CSS a browser
 * would apply, computed by the same engine, with the real theme substituted.
 *
 * It runs in milliseconds and it covers every variant, which is what makes it
 * worth having on every component rather than on a sample.
 *
 * **Its limit is the point of the browser suite.** This knows what an element
 * declares; it cannot know that a parent clips it, that a sibling shrinks it,
 * or that a fixed navigation bar is drawn on top — the last of which is a real
 * defect this project shipped (ISSUES UI-6). Those are measured in `e2e/`, on a
 * handful of tests rather than on all of them.
 */

/** The project floor (PROGRESS D17): 48 everywhere, above the AAA 44. */
const FLOOR = 48;

// Without this, each render stacks another button into the same document and
// `getByRole` throws on the second test — and, worse, leaks into the files that
// run after this one. Bun executes them all in one process.
afterEach(cleanup);

const BUTTON_VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;

const BUTTON_SIZES = ["default", "sm", "lg", "icon"] as const;

describe("target size, resolved from the real stylesheet", () => {
  for (const size of BUTTON_SIZES) {
    test(`a ${size} button declares at least ${FLOOR}px`, async () => {
      render(
        <Button size={size} type="button">
          Guardar
        </Button>,
      );
      const className = screen.getByRole("button").className;
      const height = await minimumHeight(className);

      expect(
        height,
        `size="${size}" resolved to ${height}px from: ${className}`,
      ).toBeGreaterThanOrEqual(FLOOR);
    });
  }

  for (const variant of BUTTON_VARIANTS) {
    test(`a ${variant} button declares at least ${FLOOR}px`, async () => {
      render(
        <Button type="button" variant={variant}>
          Guardar
        </Button>,
      );
      const className = screen.getByRole("button").className;
      const height = await minimumHeight(className);

      expect(
        height,
        `variant="${variant}" resolved to ${height}px from: ${className}`,
      ).toBeGreaterThanOrEqual(FLOOR);
    });
  }

  test(`an input declares at least ${FLOOR}px`, async () => {
    render(<Input aria-label="Correo" name="email" type="email" />);
    const className = screen.getByRole("textbox").className;
    const height = await minimumHeight(className);

    expect(height, `resolved to ${height}px from: ${className}`).toBeGreaterThanOrEqual(
      FLOOR,
    );
  });

  /**
   * The checkbox's target is its input, stretched over the label it sits in.
   *
   * So the question is asked of the input, and answered by the label only when
   * the input really does cover it: positioned absolutely, pinned on every
   * side, full height, inside a label that is its containing block. Anything
   * else is measured as the input alone — which is how `sr-only`, the version
   * that looks identical, comes out at 1px instead of passing on the strength
   * of a label nobody can hit. A clip counts against it too: `sr-only` added
   * beside the stretching classes loses its height and width to them in the
   * cascade, but its `clip-path` still cuts the hit area to nothing.
   */
  test(`a checkbox's input covers at least ${FLOOR}px in both directions`, async () => {
    render(<Checkbox label="Sí" />);
    const input = screen.getByRole("checkbox");
    const own = await resolve(input.className);

    const covers =
      own.declarations.get("position") === "absolute" &&
      own.pixels.get("inset") === 0 &&
      own.declarations.get("height") === "100%" &&
      own.declarations.get("width") === "100%" &&
      !own.declarations.has("clip-path") &&
      !own.declarations.has("clip");

    const label = input.closest("label");
    const container = label ? await resolve(label.className) : undefined;
    const anchored = container?.declarations.get("position") === "relative";

    const height =
      covers && anchored && label
        ? await minimumHeight(label.className)
        : await minimumHeight(input.className);
    const width =
      covers && anchored ? container?.pixels.get("min-width") : own.pixels.get("width");

    expect(height, `resolved to ${height}px from: ${input.className}`).toBeGreaterThanOrEqual(
      FLOOR,
    );
    // A two-letter label is the width case, as it is for RadioOption.
    expect(width, `resolved to ${width}px wide from: ${input.className}`).toBeGreaterThanOrEqual(
      FLOOR,
    );
  });

  /**
   * Guards the resolver itself. If `resolve` silently returned nothing for
   * everything, every assertion above would compare `undefined` and the suite
   * would be green and worthless — the same failure mode as the class-name
   * assertions it replaces.
   */
  test("the resolver reports the real height of a class known to be too short", async () => {
    expect(await minimumHeight("h-10")).toBe(40);
    expect(await minimumHeight("min-h-[48px]")).toBe(48);
    expect(await minimumHeight("h-10 min-h-[48px]")).toBe(48);
  });

  /**
   * 1.4.8 asks for line spacing of at least 1.5 in a block of text. Tailwind's
   * own `text-sm` and `text-xs` ship below that, and a utility beats anything
   * the base layer says, so the scale itself is overridden in `globals.css`.
   * That override is invisible to every other test in this project.
   */
  test("the small type sizes carry AAA line spacing", async () => {
    for (const size of ["text-xs", "text-sm", "text-base"]) {
      const { declarations } = await resolve(size);
      const fontSize = declarations.get("font-size");
      const lineHeight = declarations.get("line-height");

      expect(fontSize, `${size} produced no font-size`).toBeDefined();
      expect(lineHeight, `${size} produced no line-height`).toBeDefined();

      const ratio = await lineHeightRatio(size);
      expect(
        ratio,
        `${size} resolved to ${lineHeight} over ${fontSize}`,
      ).toBeGreaterThanOrEqual(1.5);
    }
  });
});
