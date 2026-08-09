import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Location = {
  id: string;
  name: string;
  parentId: string | null;
  _count?: { stockEntries: number };
};

let queryResult: { data: Location[] | undefined; isLoading: boolean } = {
  data: [],
  isLoading: false,
};

mock.module("@/lib/trpc/client", () => ({
  api: {
    location: {
      list: {
        useQuery: () => queryResult,
      },
    },
  },
}));

const { LocationPicker } = await import(
  "@/components/inventory/LocationPicker"
);

/**
 * Two levels deep on purpose: a grandchild is what tells a recursive render
 * apart from one that was patched to handle a single level (UI-2).
 */
const locations: Location[] = [
  { id: "kitchen", name: "Cocina", parentId: null, _count: { stockEntries: 4 } },
  { id: "fridge", name: "Nevera", parentId: "kitchen" },
  { id: "freezer", name: "Congelador", parentId: "fridge", _count: { stockEntries: 2 } },
  { id: "pantry", name: "Despensa", parentId: null, _count: { stockEntries: 0 } },
];

beforeEach(() => {
  queryResult = { data: locations, isLoading: false };
});

afterEach(cleanup);

/** The trigger, whatever it currently says. */
const trigger = () => screen.getByRole("combobox");

/** The option `aria-activedescendant` points at, or null. */
function activeOption(): HTMLElement | null {
  const id = trigger().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
}

describe("LocationPicker", () => {
  it("shows a loading state while locations are fetching", () => {
    queryResult = { data: undefined, isLoading: true };
    render(<LocationPicker onChange={() => {}} />);

    expect(screen.getByText("Cargando ubicaciones...")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows the placeholder when nothing is selected", () => {
    render(<LocationPicker onChange={() => {}} />);

    expect(screen.getByText("Seleccionar ubicación")).toBeInTheDocument();
  });

  it("accepts a custom placeholder", () => {
    render(<LocationPicker onChange={() => {}} placeholder="¿Dónde?" />);

    expect(screen.getByText("¿Dónde?")).toBeInTheDocument();
  });

  it("shows the selected location with its ancestors", () => {
    render(<LocationPicker value="freezer" onChange={() => {}} />);

    expect(
      screen.getByText("Cocina → Nevera → Congelador (2)"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Seleccionar ubicación")).toBeNull();
  });

  it("keeps the dropdown closed until the trigger is clicked", () => {
    render(<LocationPicker onChange={() => {}} />);

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByText("Cocina")).toBeNull();
  });

  // ---------------------------------------------------------------- UI-2 ---

  it("lists every location, not only the roots", async () => {
    render(<LocationPicker onChange={() => {}} />);

    await userEvent.click(trigger());

    const names = screen
      .getAllByRole("option")
      .map((option) => option.textContent?.replace(/\s+/g, " ").trim());

    expect(names).toEqual([
      "Sin ubicación específica",
      "Cocina (4)",
      "Cocina → Nevera",
      "Cocina → Nevera → Congelador (2)",
      "Despensa",
    ]);
  });

  it("names a child option after its ancestors, so two 'Nevera' are distinct", async () => {
    render(<LocationPicker onChange={() => {}} />);

    await userEvent.click(trigger());

    // The visible text is just "Nevera"; the path is the accessible name.
    expect(
      screen.getByRole("option", { name: "Cocina → Nevera" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Nevera" })).toBeNull();
  });

  it("indents deeper options further than their parents", async () => {
    render(<LocationPicker onChange={() => {}} />);

    await userEvent.click(trigger());

    const padding = (name: string) =>
      screen.getByRole("option", { name }).style.paddingLeft;

    expect(padding("Cocina (4)")).toBe("0.75rem");
    expect(padding("Cocina → Nevera")).toBe("2rem");
    expect(padding("Cocina → Nevera → Congelador (2)")).toBe("3.25rem");
  });

  it("emits a nested location's id when it is chosen", async () => {
    const onChange = mock((_id: string | undefined) => {});
    render(<LocationPicker onChange={onChange} />);

    await userEvent.click(trigger());
    await userEvent.click(
      screen.getByRole("option", { name: "Cocina → Nevera → Congelador (2)" }),
    );

    expect(onChange).toHaveBeenCalledWith("freezer");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("appends a non-zero stock count to the location name", async () => {
    render(<LocationPicker onChange={() => {}} />);

    await userEvent.click(trigger());

    expect(screen.getByRole("option", { name: "Cocina (4)" })).toBeInTheDocument();
    // A zero count must not render as "(0)".
    expect(screen.getByRole("option", { name: "Despensa" })).toBeInTheDocument();
  });

  it("offers a clear option that emits undefined", async () => {
    const onChange = mock((_id: string | undefined) => {});
    render(<LocationPicker value="kitchen" onChange={onChange} />);

    await userEvent.click(trigger());
    await userEvent.click(
      screen.getByRole("option", { name: "Sin ubicación específica" }),
    );

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("hides the clear option when allowRoot is false", async () => {
    render(<LocationPicker onChange={() => {}} allowRoot={false} />);

    await userEvent.click(trigger());

    expect(screen.queryByText("Sin ubicación específica")).toBeNull();
  });

  it("renders without crashing when the query returns nothing", () => {
    queryResult = { data: undefined, isLoading: false };
    render(<LocationPicker onChange={() => {}} />);

    expect(screen.getByText("Seleccionar ubicación")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------- UI-4 ---

  it("pairs a combobox trigger with a listbox of options", async () => {
    render(<LocationPicker onChange={() => {}} />);

    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveAttribute("aria-haspopup", "listbox");

    await userEvent.click(trigger());

    const listbox = screen.getByRole("listbox");
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger().getAttribute("aria-controls")).toBe(listbox.id);
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("is named by the element the caller points at", () => {
    render(
      <>
        <span id="loc-label">Ubicación (opcional)</span>
        <LocationPicker onChange={() => {}} labelledBy="loc-label" />
      </>,
    );

    expect(
      screen.getByRole("combobox", { name: "Ubicación (opcional)" }),
    ).toBeInTheDocument();
  });

  it("opens on ArrowDown with the selected option active", async () => {
    render(<LocationPicker value="fridge" onChange={() => {}} />);

    trigger().focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(activeOption()?.textContent?.trim()).toContain("Nevera");
  });

  it("moves the active option with Up, Down, Home and End", async () => {
    render(<LocationPicker onChange={() => {}} />);

    trigger().focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(activeOption()).toHaveTextContent("Sin ubicación específica");

    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(activeOption()).toHaveTextContent("Nevera");

    await userEvent.keyboard("{ArrowUp}");
    expect(activeOption()).toHaveTextContent("Cocina");

    await userEvent.keyboard("{End}");
    expect(activeOption()).toHaveTextContent("Despensa");

    await userEvent.keyboard("{Home}");
    expect(activeOption()).toHaveTextContent("Sin ubicación específica");
  });

  it("chooses the active option with Enter", async () => {
    const onChange = mock((_id: string | undefined) => {});
    render(<LocationPicker onChange={onChange} />);

    trigger().focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(activeOption()).toHaveTextContent("Congelador");

    await userEvent.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("freezer");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("chooses the active option with Space", async () => {
    const onChange = mock((_id: string | undefined) => {});
    render(<LocationPicker onChange={onChange} />);

    trigger().focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await userEvent.keyboard(" ");

    expect(onChange).toHaveBeenCalledWith("kitchen");
  });

  it("dismisses on Escape and leaves focus on the trigger", async () => {
    const onChange = mock((_id: string | undefined) => {});
    render(<LocationPicker onChange={onChange} />);

    trigger().focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    // The attribute is asserted before the element is queried: when this test
    // fails, `toBeNull()` on a live happy-dom node serialises every computed
    // style getter on it and the run takes minutes rather than seconds.
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("puts no second focusable control in the tab order while open", async () => {
    render(<LocationPicker onChange={() => {}} />);

    await userEvent.click(trigger());

    // Described rather than compared as nodes: a failing `toEqual` on live
    // happy-dom elements serialises every computed style getter on them.
    const focusable = [
      ...document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].map(
      (element) =>
        `${element.tagName.toLowerCase()}[role=${element.getAttribute("role")}]` +
        `[aria-label=${element.getAttribute("aria-label")}]`,
    );

    expect(focusable).toEqual(["button[role=combobox][aria-label=Ubicación]"]);
  });

  it("closes on a click outside without choosing anything", async () => {
    const onChange = mock((_id: string | undefined) => {});
    render(<LocationPicker onChange={onChange} />);

    await userEvent.click(trigger());
    const scrim = document.querySelector('[aria-hidden="true"].fixed');
    expect(scrim).not.toBeNull();
    await userEvent.click(scrim as Element);

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
