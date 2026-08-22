import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";
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
    renderWithIntl(<LocationPicker onChange={() => {}} />);

    expect(screen.getByText("Cargando ubicaciones…")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeAbsent();
  });

  it("shows the placeholder when nothing is selected", () => {
    renderWithIntl(<LocationPicker onChange={() => {}} />);

    expect(screen.getByText("Seleccionar ubicación")).toBeInTheDocument();
  });

  it("accepts a custom placeholder", () => {
    renderWithIntl(<LocationPicker onChange={() => {}} placeholder="¿Dónde?" />);

    expect(screen.getByText("¿Dónde?")).toBeInTheDocument();
  });

  it("shows the selected location with its ancestors", () => {
    renderWithIntl(<LocationPicker value="freezer" onChange={() => {}} />);

    expect(
      screen.getByText("Cocina → Nevera → Congelador (2)"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Seleccionar ubicación")).toBeAbsent();
  });

  it("keeps the dropdown closed until the trigger is clicked", () => {
    renderWithIntl(<LocationPicker onChange={() => {}} />);

    expect(screen.queryByRole("listbox")).toBeAbsent();
    expect(screen.queryByText("Cocina")).toBeAbsent();
  });

  // ---------------------------------------------------------------- UI-2 ---

  it("lists every location, not only the roots", async () => {
    renderWithIntl(<LocationPicker onChange={() => {}} />);

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
    renderWithIntl(<LocationPicker onChange={() => {}} />);

    await userEvent.click(trigger());

    // The visible text is just "Nevera"; the path is the accessible name.
    expect(
      screen.getByRole("option", { name: "Cocina → Nevera" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Nevera" })).toBeAbsent();
  });

  it("indents deeper options further than their parents", async () => {
    renderWithIntl(<LocationPicker onChange={() => {}} />);

    await userEvent.click(trigger());

    const padding = (name: string) =>
      screen.getByRole("option", { name }).style.paddingLeft;

    expect(padding("Cocina (4)")).toBe("0.75rem");
    expect(padding("Cocina → Nevera")).toBe("2rem");
    expect(padding("Cocina → Nevera → Congelador (2)")).toBe("3.25rem");
  });

  it("emits a nested location's id when it is chosen", async () => {
    const onChange = mock((_id: string | undefined) => {});
    renderWithIntl(<LocationPicker onChange={onChange} />);

    await userEvent.click(trigger());
    await userEvent.click(
      screen.getByRole("option", { name: "Cocina → Nevera → Congelador (2)" }),
    );

    expect(onChange).toHaveBeenCalledWith("freezer");
    expect(screen.queryByRole("listbox")).toBeAbsent();
  });

  it("appends a non-zero stock count to the location name", async () => {
    renderWithIntl(<LocationPicker onChange={() => {}} />);

    await userEvent.click(trigger());

    expect(screen.getByRole("option", { name: "Cocina (4)" })).toBeInTheDocument();
    // A zero count must not render as "(0)".
    expect(screen.getByRole("option", { name: "Despensa" })).toBeInTheDocument();
  });

  it("offers a clear option that emits undefined", async () => {
    const onChange = mock((_id: string | undefined) => {});
    renderWithIntl(<LocationPicker value="kitchen" onChange={onChange} />);

    await userEvent.click(trigger());
    await userEvent.click(
      screen.getByRole("option", { name: "Sin ubicación específica" }),
    );

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("hides the clear option when allowRoot is false", async () => {
    renderWithIntl(<LocationPicker onChange={() => {}} allowRoot={false} />);

    await userEvent.click(trigger());

    expect(screen.queryByText("Sin ubicación específica")).toBeAbsent();
  });

  it("renders without crashing when the query returns nothing", () => {
    queryResult = { data: undefined, isLoading: false };
    renderWithIntl(<LocationPicker onChange={() => {}} />);

    expect(screen.getByText("Seleccionar ubicación")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------- UI-4 ---

  it("pairs a combobox trigger with a listbox of options", async () => {
    renderWithIntl(<LocationPicker onChange={() => {}} />);

    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveAttribute("aria-haspopup", "listbox");

    await userEvent.click(trigger());

    const listbox = screen.getByRole("listbox");
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger().getAttribute("aria-controls")).toBe(listbox.id);
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("is named by the element the caller points at", () => {
    renderWithIntl(
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
    renderWithIntl(<LocationPicker value="fridge" onChange={() => {}} />);

    trigger().focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(activeOption()?.textContent?.trim()).toContain("Nevera");
  });

  it("moves the active option with Up, Down, Home and End", async () => {
    renderWithIntl(<LocationPicker onChange={() => {}} />);

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
    renderWithIntl(<LocationPicker onChange={onChange} />);

    trigger().focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(activeOption()).toHaveTextContent("Congelador");

    await userEvent.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("freezer");
    expect(screen.queryByRole("listbox")).toBeAbsent();
  });

  it("chooses the active option with Space", async () => {
    const onChange = mock((_id: string | undefined) => {});
    renderWithIntl(<LocationPicker onChange={onChange} />);

    trigger().focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await userEvent.keyboard(" ");

    expect(onChange).toHaveBeenCalledWith("kitchen");
  });

  it("dismisses on Escape and leaves focus on the trigger", async () => {
    const onChange = mock((_id: string | undefined) => {});
    renderWithIntl(<LocationPicker onChange={onChange} />);

    trigger().focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    // The attribute is asserted before the element is queried: when this test
    // fails, `toBeNull()` on a live happy-dom node serialises every computed
    // style getter on it and the run takes minutes rather than seconds.
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeAbsent();
    expect(document.activeElement).toBe(trigger());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("puts no second focusable control in the tab order while open", async () => {
    renderWithIntl(<LocationPicker onChange={() => {}} />);

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
    renderWithIntl(<LocationPicker onChange={onChange} />);

    await userEvent.click(trigger());
    const scrim = document.querySelector('[aria-hidden="true"].fixed');
    expect(scrim).not.toBeNull();
    await userEvent.click(scrim as Element);

    expect(screen.queryByRole("listbox")).toBeAbsent();
    expect(onChange).not.toHaveBeenCalled();
    // And focus comes back to the trigger. Dismissing a panel that took focus
    // without returning it drops a keyboard user at the top of the document,
    // which is the same defect as not closing at all from where they are
    // standing. Moved down from the browser suite, which asserted it against a
    // real click and paid a page load for a fact about the DOM.
    expect(document.activeElement).toBe(trigger());
  });
});

/**
 * ISSUES.md I18N-5 — the four strings that were written into the component.
 *
 * The `aria-label` matters more than the other three: it is what a screen
 * reader announces, and there is no visible text to fall back on, so an
 * English-speaking user met a Spanish control name with nothing to correct it.
 * The rest are visible and at least look like a bug.
 *
 * Asserted in English, because that is the only language that can tell a
 * translated string from a hardcoded one here.
 */
describe("in English", () => {
  it("names the control in the reader's language", () => {
    renderWithIntl(<LocationPicker onChange={() => {}} />, { locale: "en" });

    expect(screen.getByRole("combobox", { name: "Location" })).toBeInTheDocument();
  });

  it("prompts in the reader's language", () => {
    renderWithIntl(<LocationPicker onChange={() => {}} />, { locale: "en" });

    expect(screen.getByText("Choose a location")).toBeInTheDocument();
  });

  it("offers the no-location row in the reader's language", async () => {
    renderWithIntl(<LocationPicker onChange={() => {}} />, { locale: "en" });

    await userEvent.click(screen.getByRole("combobox"));

    expect(
      screen.getByRole("option", { name: "No particular location" }),
    ).toBeInTheDocument();
  });

  it("still lets a caller supply its own prompt", () => {
    // The prop was a default argument and is now a fallback; a caller that
    // passes wording must still win, or two forms lose their labels.
    renderWithIntl(<LocationPicker onChange={() => {}} placeholder="Where?" />, {
      locale: "en",
    });

    expect(screen.getByText("Where?")).toBeInTheDocument();
  });
});
