import "../setup/matchers";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * The checkbox primitive: a real input, named by its words, described by its
 * hint, and part of a form like any other. Its 48px target is measured in
 * `target-size.test.tsx`, with the other primitives.
 */
afterEach(cleanup);

const LABEL = "Mantener la sesión iniciada";
const HINT = "Márcalo en los dispositivos de casa que usas a diario.";

describe("Checkbox", () => {
  it("is named by its label, not by its hint", () => {
    render(<Checkbox hint={HINT} label={LABEL} />);

    // The exact name: a hint inside the label would make it both strings.
    expect(screen.getByRole("checkbox")).toHaveAccessibleName(LABEL);
  });

  it("is described by its hint", () => {
    render(<Checkbox hint={HINT} label={LABEL} />);

    expect(screen.getByRole("checkbox")).toHaveAccessibleDescription(HINT);
  });

  it("points at no description when it has no hint", () => {
    render(<Checkbox label={LABEL} />);

    // A dangling aria-describedby names an id that does not exist.
    expect(screen.getByRole("checkbox").hasAttribute("aria-describedby")).toBe(
      false,
    );
  });

  it("gives two checkboxes different hint ids", () => {
    render(
      <>
        <Checkbox hint="uno" label="A" />
        <Checkbox hint="dos" label="B" />
      </>,
    );

    expect(screen.getByRole("checkbox", { name: "A" })).toHaveAccessibleDescription(
      "uno",
    );
    expect(screen.getByRole("checkbox", { name: "B" })).toHaveAccessibleDescription(
      "dos",
    );
  });

  it("reports the new state each time it is toggled", () => {
    const onCheckedChange = mock((_checked: boolean) => {});
    render(<Checkbox label={LABEL} onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox");

    fireEvent.click(box);
    fireEvent.click(box);

    expect(onCheckedChange.mock.calls).toEqual([[true], [false]]);
  });

  it("toggles from a click on its words", () => {
    const onCheckedChange = mock((_checked: boolean) => {});
    render(<Checkbox label={LABEL} onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByText(LABEL));

    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(onCheckedChange.mock.calls).toEqual([[true]]);
  });

  it("follows a controlled value", () => {
    const { rerender } = render(
      <Checkbox checked={false} label={LABEL} onCheckedChange={() => {}} />,
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();

    rerender(<Checkbox checked label={LABEL} onCheckedChange={() => {}} />);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("submits 'on' in a plain form once ticked, and nothing before", () => {
    const { container } = render(
      <form>
        <Checkbox label={LABEL} name="rememberMe" />
      </form>,
    );
    const form = container.querySelector("form")!;

    expect(new FormData(form).get("rememberMe")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox"));

    expect(new FormData(form).get("rememberMe")).toBe("on");
  });

  it("starts ticked from defaultChecked", () => {
    const { container } = render(
      <form>
        <Checkbox defaultChecked label={LABEL} name="rememberMe" />
      </form>,
    );

    expect(new FormData(container.querySelector("form")!).get("rememberMe")).toBe(
      "on",
    );
  });

  it("can be disabled", () => {
    render(<Checkbox disabled label={LABEL} />);

    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("draws its box after the input, so the box can follow :checked", () => {
    const { container } = render(<Checkbox label={LABEL} />);
    const input = screen.getByRole("checkbox");
    const drawn = container.querySelector("[aria-hidden='true']");

    // `peer-checked:` is a sibling selector (`.peer:checked ~ *`): it matches
    // only elements *after* the input, and only if the input is the peer.
    // With the box first, or `peer` gone, the tick would never be drawn —
    // in either the controlled or the uncontrolled case.
    expect(input.classList.contains("peer")).toBe(true);
    expect(drawn).not.toBeNull();
    expect(
      input.compareDocumentPosition(drawn!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(drawn!.className).toContain("peer-checked:[&>svg]:visible");
    expect(drawn!.querySelector("svg")?.getAttribute("class")).toContain(
      "invisible",
    );
  });
});
