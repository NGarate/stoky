import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/**
 * `Select` and `Input` are the same control wearing different jobs.
 *
 * They sit side by side in every form that has both — the shopping row puts a
 * quantity next to a shop, `/inventory/add` a number next to a unit — so any
 * difference in geometry or fill reads as two kinds of box rather than one.
 * `Select` was `bg-card` while `Input` was `bg-background`, which on a card
 * is a visible step between two adjacent fields.
 */

afterEach(cleanup);

/** The classes that decide what a field looks like, not how it is placed. */
function surface(element: Element): string[] {
  return element.className
    .split(/\s+/)
    .filter((name) => /^(bg-|border|min-h-|rounded|text-)/.test(name))
    .sort();
}

describe("Select and Input", () => {
  it("are filled and framed the same", () => {
    render(
      <>
        <Input aria-label="cantidad" />
        <Select aria-label="tienda">
          <option value="">-</option>
        </Select>
      </>,
    );

    const input = screen.getByLabelText("cantidad");
    const select = screen.getByLabelText("tienda");

    for (const shared of [
      "bg-background",
      "border-input",
      "min-h-[48px]",
      "rounded-md",
    ]) {
      expect(surface(input)).toContain(shared);
      expect(surface(select)).toContain(shared);
    }
  });

  it("clears the target floor, like every control in the system", () => {
    render(
      <Select aria-label="tienda">
        <option value="">-</option>
      </Select>,
    );

    expect(screen.getByLabelText("tienda").className).toContain("min-h-[48px]");
  });
});
