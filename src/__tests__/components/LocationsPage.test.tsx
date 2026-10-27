import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";
import { axeViolations } from "../utils/axe";

/**
 * The storage locations screen could not create, rename or remove anything.
 *
 * `locationRouter` has had all three writes since Phase 2; this route drew the
 * tree read-only and told the reader, in a hardcoded sentence, that locations
 * "se pueden crear al añadir stock". The add-stock form only ever offered
 * locations that already existed, so the first one could not be made from
 * anywhere in the interface and none could ever be renamed.
 *
 * These cases are the shape `StoresPage.test.tsx` established — the screen is
 * that screen with a hierarchy — plus the three things the hierarchy costs: a
 * parent select, that select refusing to offer a move into your own subtree,
 * and a row that says which location holds it.
 */
const invalidated: string[] = [];
// Emptied rather than reassigned: the mutation mocks close over these arrays
// at module-mock time, so a fresh binding leaves them pushing to the old one
// and every assertion reads zero.
const createCalls: Record<string, unknown>[] = [];
const updateCalls: Record<string, unknown>[] = [];
const deleteCalls: Record<string, unknown>[] = [];

/**
 * Nevera ⊃ Cajón de las verduras, and Despensa beside it.
 *
 * Two levels rather than one, because the flat cases pass on a list and the
 * ones that matter here — the parent select, the subtree exclusion, the
 * nested `<ul>` — need something to nest.
 */
const tree = [
  {
    id: "l1",
    name: "Nevera",
    parentId: null,
    householdId: "h1",
    _count: { stockEntries: 0 },
    children: [
      {
        id: "l2",
        name: "Cajón de las verduras",
        parentId: "l1",
        householdId: "h1",
        _count: { stockEntries: 3 },
        children: [],
      },
    ],
  },
  {
    id: "l3",
    name: "Despensa",
    parentId: null,
    householdId: "h1",
    _count: { stockEntries: 0 },
    children: [],
  },
];

/** Who the screen thinks is looking. All three writes are admin-only. */
let role = "OWNER";

/** When set, every mutation reports this instead of succeeding. */
let failure: { data?: { code?: string } } | null = null;

interface Callbacks {
  onSuccess?: (data: unknown) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

function mutation(record: Record<string, unknown>[], result?: unknown) {
  return {
    useMutation: (opts?: Callbacks) => ({
      mutate: (input: Record<string, unknown>, perCall?: Callbacks) => {
        record.push(input);
        if (failure) {
          opts?.onError?.(failure);
          // Delete carries no name in its input or its result, so the page
          // passes its callbacks per call — where the row still knows which
          // location it is. Failures take the same route.
          perCall?.onError?.(failure);
          return;
        }
        void opts?.onSuccess?.(result);
        void perCall?.onSuccess?.(result);
      },
      isPending: false,
    }),
  };
}

// The real snackbar rather than a stub: `mock.module` replaces a module for
// the whole bun process, so stubbing it here would also replace the component
// `Snackbar.test.tsx` renders.
mock.module("@/lib/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending: [], failed: [], status: "idle", full: false },
    enqueue: () => ({ ok: true, id: "op" }),
    drain: () => {},
    cancel: () => true,
    holdRemainingMs: () => 0,
    retry: () => {},
    discard: () => {},
    flush: async () => {},
    purgeAll: () => {},
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      location: { invalidate: async () => void invalidated.push("location") },
    }),
    // The screen asks who is looking before it draws an admin's controls.
    auth: { me: { useQuery: () => ({ data: { role } }) } },
    location: {
      getTree: {
        useQuery: () => ({
          data: tree,
          error: null,
          fetchStatus: "idle",
          isPending: false,
          refetch: () => {},
        }),
      },
      create: mutation(createCalls, { id: "l4", name: "Congelador" }),
      update: mutation(updateCalls, { id: "l2", name: "Cajón de la fruta" }),
      delete: mutation(deleteCalls),
    },
  },
}));

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const LocationsPage = (
  await import("@/app/(dashboard)/settings/locations/page")
).default;

const renderPage = () =>
  renderWithIntl(
    <SnackbarProvider>
      <LocationsPage />
    </SnackbarProvider>,
    { locale: "es" },
  );

/** The parent `<select>`, once the form is open. */
const parentSelect = () =>
  screen.getByLabelText("Está dentro de") as HTMLSelectElement;

const optionLabels = () =>
  Array.from(parentSelect().options).map((option) => option.textContent);

/**
 * A row, found by the action that names it.
 *
 * Not by its title text: each row also carries the name inside the `sr-only`
 * suffix that disambiguates "Editar" and "Eliminar" for a screen reader, so
 * `getByText(name)` matches three nodes. The button's accessible name is the
 * one handle that is unique per row and is also what a reader actually has.
 */
const rowFor = (name: string): HTMLElement => {
  const action = screen.getByRole("button", {
    name: new RegExp(`Editar ${name}`),
  });
  const row = action.closest("li");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

beforeEach(() => {
  invalidated.length = 0;
  createCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  role = "OWNER";
  failure = null;
});

afterEach(cleanup);

describe("the storage locations screen", () => {
  it("creates a location, which nothing in the interface could do", async () => {
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: "Crear ubicación" }),
    );
    await userEvent.type(
      screen.getByLabelText("Nombre de la ubicación"),
      "Congelador",
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toEqual({ name: "Congelador", parentId: undefined });
  });

  it("creates it inside another when one is chosen", async () => {
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: "Crear ubicación" }),
    );
    await userEvent.type(
      screen.getByLabelText("Nombre de la ubicación"),
      "Congelador",
    );
    await userEvent.selectOptions(parentSelect(), "l1");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(createCalls[0]).toEqual({ name: "Congelador", parentId: "l1" });
  });

  it("renames a location, opening the form already filled in", async () => {
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: /Editar Nevera/ }),
    );

    const field = screen.getByLabelText("Nombre de la ubicación");
    expect(field).toHaveValue("Nevera");

    await userEvent.clear(field);
    await userEvent.type(field, "Frigorífico");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(updateCalls[0]).toEqual({
      id: "l1",
      name: "Frigorífico",
      parentId: undefined,
    });
  });

  /**
   * `update` refuses a move into your own descendant — it would cut the branch
   * off from the root — and refuses a location as its own parent. Offering
   * either is offering a refusal, so the select does not.
   */
  it("does not offer to move a location inside its own subtree", async () => {
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: /Editar Nevera/ }),
    );

    // "Nevera" itself and its child are gone; the unrelated root stays.
    expect(optionLabels()).toEqual(["No está dentro de ninguna", "Despensa"]);
  });

  it("offers every location when creating, because a new one has no subtree", async () => {
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: "Crear ubicación" }),
    );

    expect(optionLabels()).toEqual([
      "No está dentro de ninguna",
      "Nevera",
      "— Cajón de las verduras",
      "Despensa",
    ]);
  });

  it("draws a row's delete as a destructive button, not a coloured span", () => {
    renderPage();

    const remove = screen.getByRole("button", { name: /Eliminar Despensa/ });
    expect(remove.className).toContain("text-destructive");
    expect(remove.querySelector(".text-destructive")).toBeNull();
  });

  it("refetches the tree after every write", async () => {
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: /Eliminar Despensa/ }),
    );

    // Without this the change does not appear until the route is left and
    // re-entered, and the form closing is the only sign anything happened.
    expect(invalidated).toContain("location");
    expect(deleteCalls[0]).toEqual({ id: "l3" });
  });

  it("says which location it created, and which it deleted", async () => {
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: /Eliminar Despensa/ }),
    );

    expect(
      await screen.findAllByText(/Eliminaste la ubicación «Despensa»/),
    ).not.toHaveLength(0);
  });

  it("explains a refused delete only when it knows the reason", async () => {
    failure = { data: { code: "INTERNAL_SERVER_ERROR" } };
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: /Eliminar Despensa/ }),
    );

    // "Todavía tiene algo dentro" is true of a CONFLICT and a guess about
    // anything else.
    expect(await screen.findAllByText(/Vuelve a intentarlo/)).not.toHaveLength(
      0,
    );
    expect(screen.queryByText(/Todavía tiene algo dentro/)).toBeAbsent();
  });

  it("offers a member none of the three things the server refuses", async () => {
    role = "MEMBER";
    renderPage();

    expect(
      screen.queryByRole("button", { name: "Crear ubicación" }),
    ).toBeAbsent();
    expect(
      screen.queryByRole("button", { name: /Editar Nevera/ }),
    ).toBeAbsent();
    expect(
      screen.queryByRole("button", { name: /Eliminar Nevera/ }),
    ).toBeAbsent();
    expect(
      screen.getByText(/Solo quien administra el hogar/),
    ).toBeInTheDocument();
  });

  /**
   * The tree a reader sees has to be the tree a screen reader announces: the
   * child sits in a `<ul>` inside its parent's `<li>`, not in a sibling list.
   */
  it("nests a sub-location inside the item it hangs off", () => {
    renderPage();

    const child = rowFor("Cajón de las verduras");
    const parentItem = child.parentElement?.closest("li");

    // No `expect(parentItem).not.toBeNull()`: a matcher that holds a happy-dom
    // node is the trap `toBeAbsent` exists for (see `setup/matchers.ts`).
    // `within` throws on undefined and `getByRole` throws when the row is not
    // the parent's, so both facts are still asserted — just without a node
    // ever reaching a matcher.
    if (!parentItem) throw new Error("the sub-location is not inside any row");

    expect(
      within(parentItem).getByRole("button", { name: /Editar Nevera/ }),
    ).toBeInTheDocument();
  });

  it("says which location holds a sub-location, and how much is in it", () => {
    renderPage();

    const row = within(rowFor("Cajón de las verduras"));

    expect(row.getByText("Dentro de")).toBeInTheDocument();
    expect(row.getByText("Nevera")).toBeInTheDocument();
    expect(row.getByText("Productos guardados")).toBeInTheDocument();
    expect(row.getByText("3")).toBeInTheDocument();
  });

  /**
   * The last typed "←" in the application lived on this screen, in JSX rather
   * than in a catalogue, so the sweep that stripped them from `es.json` could
   * not reach it. `BackLink` draws the arrow `aria-hidden`; a second one in
   * the text is heard as "flecha hacia la izquierda" and seen twice.
   */
  it("offers one way back to the hub, carrying one arrow", () => {
    renderPage();

    const back = screen.getByRole("link", { name: "Volver a configuración" });

    expect(back).toHaveAttribute("href", "/settings");
    // `.length` rather than the NodeList itself. `setup/matchers.ts` is the
    // long version: a happy-dom node inside a matcher is a node graph the
    // runner may walk to build a message, and that walk does not terminate in
    // any useful time.
    expect(back.querySelectorAll("svg").length).toBe(1);
    expect(back.textContent).toBe("Volver a configuración");
  });
});

it("passes axe at AAA", async () => {
  const { container } = renderPage();
  await screen.findByRole("button", { name: /Editar Nevera/ });
  expect(await axeViolations(container)).toBe("");
});
