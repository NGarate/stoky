import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RadioOption } from "@/components/ui/radio-option";
import { minimumHeight } from "../setup/tailwind";

/**
 * The technique this exists to stop a fourth screen getting wrong.
 *
 * A bare radio is about 13px across, so the target that has to clear the
 * 48px floor is the *input*, not the label around it. The obvious fix —
 * `sr-only` on the input, styling the label — looks identical and moves the
 * target back to 13px, and nothing short of a browser measurement says so.
 */
afterEach(cleanup);

describe("RadioOption", () => {
  it("is a real radio, not a div pretending", () => {
    render(
      <RadioOption checked={false} name="g" onSelect={() => {}} value="a">
        Claro
      </RadioOption>,
    );

    expect(screen.getByRole("radio")).toBeInTheDocument();
  });

  it("puts the 48px floor on the input, not only on the label", async () => {
    const { container } = render(
      <RadioOption checked={false} name="g" onSelect={() => {}} value="a">
        Claro
      </RadioOption>,
    );

    const input = screen.getByRole("radio");
    const label = container.querySelector("label")!;

    // The input covers the label, so the label's height is the input's.
    expect(input.className).toContain("inset-0");
    expect(input.className).toContain("h-full");
    expect(await minimumHeight(label.className)).toBeGreaterThanOrEqual(48);
    // Not `sr-only`: that is the mistake this component exists to prevent.
    expect(input.className).not.toContain("sr-only");
  });

  it("clears 48px in both directions as a segment", async () => {
    const { container } = render(
      <RadioOption checked={false} name="g" onSelect={() => {}} value="a">
        Sí
      </RadioOption>,
    );

    // A two-letter option is the width case, the same one that caught
    // ItemRow's title.
    expect(container.querySelector("label")?.className).toContain("min-w-[48px]");
  });

  it("reports the choice when it is made", () => {
    const onSelect = mock(() => {});
    render(
      <RadioOption checked={false} name="g" onSelect={onSelect} value="a">
        Claro
      </RadioOption>,
    );

    fireEvent.click(screen.getByRole("radio"));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("does not say which is chosen with colour alone", () => {
    const { container } = render(
      <RadioOption checked name="g" onSelect={() => {}} value="a">
        Claro
      </RadioOption>,
    );

    // Weight as well as fill: a reader who cannot tell the two greens apart
    // still sees which one is bolder.
    expect(container.querySelector("label")?.className).toContain("font-semibold");
  });

  it("keeps the label from swallowing the click", () => {
    const { container } = render(
      <RadioOption checked={false} name="g" onSelect={() => {}} value="a">
        Claro
      </RadioOption>,
    );

    expect(container.querySelector("span")?.className).toContain(
      "pointer-events-none",
    );
  });
});
