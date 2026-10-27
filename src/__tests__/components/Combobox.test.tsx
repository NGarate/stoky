import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Combobox, matchingOptions } from "@/components/ui/combobox";
import { minimumHeight } from "../setup/tailwind";

/**
 * The free-text field with suggestions: brand, category, unit and shop.
 *
 * The two things it must never do are the two a `<select>` would: refuse a
 * value nobody has used yet, and swallow the Enter that submits the form.
 */

afterEach(cleanup);

const BRANDS = ["Hacendado", "Pascual", "Puleva", "Café Saula"];

function Harness({
  options = BRANDS,
  onSubmit = () => {},
}: {
  options?: string[];
  onSubmit?: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <label htmlFor="brand">Marca</label>
      <Combobox
        id="brand"
        listLabel="Marcas usadas"
        onValueChange={setValue}
        options={options}
        value={value}
      />
    </form>
  );
}

describe("matchingOptions", () => {
  it("ignores case and accents, and keeps the order given", () => {
    expect(matchingOptions(BRANDS, "CAFE")).toEqual(["Café Saula"]);
    expect(matchingOptions(BRANDS, "pu")).toEqual(["Puleva"]);
    expect(matchingOptions(BRANDS, "")).toEqual(BRANDS);
  });

  it("offers one spelling of a value stored in two cases", () => {
    expect(matchingOptions(["Hacendado", "hacendado", " "], "")).toEqual([
      "Hacendado",
    ]);
  });

  it("offers no more than fifty at once", () => {
    const many = Array.from({ length: 80 }, (_, i) => `Marca ${i}`);
    expect(matchingOptions(many, "")).toHaveLength(50);
  });
});

describe("Combobox", () => {
  it("is a named combobox that clears the target floor", async () => {
    render(<Harness />);

    const field = screen.getByRole("combobox", { name: "Marca" });
    expect(field).toHaveAttribute("aria-autocomplete", "list");
    expect(await minimumHeight(field.className)).toBeGreaterThanOrEqual(48);
  });

  it("shows what exists on focus, narrowed by what is typed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("combobox", { name: "Marca" }));
    expect(
      screen.getByRole("listbox", { name: "Marcas usadas" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(4);

    await user.keyboard("pu");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Puleva"]);
  });

  it("takes a suggestion by pointer", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const field = screen.getByRole("combobox", { name: "Marca" });
    await user.click(field);
    await user.click(screen.getByRole("option", { name: "Pascual" }));

    expect(field).toHaveValue("Pascual");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  it("takes the highlighted suggestion on Enter without submitting", async () => {
    const user = userEvent.setup();
    const submitted: string[] = [];
    render(<Harness onSubmit={(value) => submitted.push(value)} />);

    const field = screen.getByRole("combobox", { name: "Marca" });
    await user.click(field);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(field).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Pascual" }).id,
    );

    await user.keyboard("{Enter}");
    expect(field).toHaveValue("Pascual");
    expect(submitted).toEqual([]);
  });

  it("accepts a value nobody has used, and Enter then submits it", async () => {
    const user = userEvent.setup();
    const submitted: string[] = [];
    render(<Harness onSubmit={(value) => submitted.push(value)} />);

    const field = screen.getByRole("combobox", { name: "Marca" });
    await user.click(field);
    await user.keyboard("Marca Nueva");

    // Nothing matches, so there is no panel to confirm anything in.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{Enter}");
    expect(submitted).toEqual(["Marca Nueva"]);
  });

  it("shows every choice when opened on a value, and narrows once typing", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const field = screen.getByRole("combobox", { name: "Marca" });
    await user.click(field);
    await user.click(screen.getByRole("option", { name: "Puleva" }));
    await user.tab();
    await user.click(field);

    // Opened on "Puleva", the panel is still the whole list, as a select is.
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByRole("option", { name: "Puleva" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard(
      "{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}",
    );
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Pascual", "Puleva"]);
  });

  it("closes on Escape and keeps what was typed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const field = screen.getByRole("combobox", { name: "Marca" });
    await user.click(field);
    await user.keyboard("Ha{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field).toHaveValue("Ha");
  });

  it("is a plain field when there is nothing to suggest", async () => {
    const user = userEvent.setup();
    render(<Harness options={[]} />);

    const field = screen.getByRole("combobox", { name: "Marca" });
    await user.click(field);
    await user.keyboard("{ArrowDown}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute("aria-activedescendant");
  });
});
