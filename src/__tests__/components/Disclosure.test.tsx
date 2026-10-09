import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { Disclosure } from "@/components/ui/disclosure";
import { minimumHeight } from "../setup/tailwind";

/**
 * The folded-away primitive.
 *
 * Three screens wrote `<details>`/`<summary>` by hand, each restating the
 * 48px floor, and the two forms' `flex` summaries dropped the native
 * triangle — nothing said the row would open.
 */
afterEach(cleanup);

describe("Disclosure", () => {
  for (const variant of ["panel", "inline"] as const) {
    it(`keeps the ${variant} summary a 48px target`, async () => {
      const { container } = render(
        <Disclosure summary="Más opciones" variant={variant}>
          <p>dentro</p>
        </Disclosure>,
      );
      const summary = container.querySelector("summary")!;

      expect(await minimumHeight(summary.className)).toBeGreaterThanOrEqual(48);
    });
  }

  it("draws its own open/closed cue, hidden from assistive technology", () => {
    const { container } = render(
      <Disclosure summary="Más opciones">
        <p>dentro</p>
      </Disclosure>,
    );
    const summary = container.querySelector("summary")!;

    // The native triangle is removed (a flex summary loses it in some
    // engines), so the chevron is the cue; `<details>` announces the state.
    expect(summary.className).toContain("list-none");
    const chevron = summary.querySelector("svg");
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
    expect(chevron?.getAttribute("class")).toContain("group-open:rotate-180");
    expect(summary.textContent).toBe("Más opciones");
  });

  it("hands its <details> to a form that must open it on an error", () => {
    const ref = createRef<HTMLDetailsElement>();
    render(
      <Disclosure ref={ref} summary="Más opciones">
        <p>dentro</p>
      </Disclosure>,
    );

    expect(ref.current?.tagName).toBe("DETAILS");
    ref.current?.setAttribute("open", "");
    expect(ref.current?.open).toBe(true);
  });
});
