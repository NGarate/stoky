import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * The stores settings screen writes to the list rendered directly below it,
 * and told the cache about none of it.
 *
 * A store created here did not appear until the route was left and re-entered,
 * and a deleted one stayed on screen. The form closing was the only sign
 * anything had happened — which is exactly how a write that succeeded and a
 * write that silently failed came to look the same.
 */
const invalidated: string[] = [];
// Emptied rather than reassigned: the mutation mocks close over these
// arrays at module-mock time, so a fresh binding leaves them pushing to the
// old one and every assertion reads zero.
const createCalls: unknown[] = [];
const deleteCalls: unknown[] = [];

const stores = [{ id: "s1", name: "Mercadona", address: "Calle A" }];

/** Who the screen thinks is looking. All three writes are admin-only. */
let role = "OWNER";

/** When set, every mutation reports this instead of succeeding. */
let failure: { data?: { code?: string } } | null = null;

interface Callbacks {
  onSuccess?: (data: unknown) => void | Promise<void>;
  onError?: (error: { data?: { code?: string } }) => void;
}

function mutation(record: unknown[], result?: unknown) {
  return {
    useMutation: (opts?: Callbacks) => ({
      mutate: (input: unknown, perCall?: Callbacks) => {
        record.push(input);
        if (failure) {
          opts?.onError?.(failure);
          // Delete carries no name in its input or result, so the page passes
          // its callbacks per call — where the row still knows which store it
          // is. Failures take the same route.
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
      store: {
        list: { invalidate: async () => void invalidated.push("store.list") },
      },
    }),
    // The screen asks who is looking before it draws an admin's controls.
    auth: { me: { useQuery: () => ({ data: { role } }) } },
    store: {
      list: { useQuery: () => ({ data: stores, isLoading: false }) },
      create: mutation(createCalls, { id: "s2", name: "Lidl" }),
      update: mutation([], { id: "s1", name: "Mercadona" }),
      delete: mutation(deleteCalls),
    },
  },
}));

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const StoresPage = (await import("@/app/(dashboard)/settings/stores/page"))
  .default;

const renderPage = () =>
  renderWithIntl(
    <SnackbarProvider>
      <StoresPage />
    </SnackbarProvider>,
    { locale: "es" },
  );

beforeEach(() => {
  invalidated.length = 0;
  createCalls.length = 0;
  deleteCalls.length = 0;
  role = "OWNER";
  failure = null;
});

afterEach(cleanup);

describe("the stores settings screen", () => {
  it("refetches the list after creating a store", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Crear tienda" }));
    await userEvent.type(screen.getByLabelText(/Nombre de la tienda/), "Lidl");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    // Without this the new store does not appear until the route is left and
    // re-entered, and the form closing is the only sign anything happened.
    expect(invalidated).toContain("store.list");
  });

  it("draws a row's delete as a destructive button, not a coloured span", () => {
    renderPage();

    // The red word was a `<span className="text-destructive">` inside a
    // ghost button; the button itself is now the variant that says it.
    const remove = screen.getByRole("button", { name: /Eliminar Mercadona/ });
    expect(remove.className).toContain("text-destructive");
    expect(remove.querySelector(".text-destructive")).toBeNull();
  });

  it("refetches the list after deleting one", async () => {
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: /Eliminar Mercadona/ }),
    );

    expect(deleteCalls).toHaveLength(1);
    expect(invalidated).toContain("store.list");
  });

  it("says which store it created, and which it deleted", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Crear tienda" }));
    await userEvent.type(screen.getByLabelText(/Nombre de la tienda/), "Lidl");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    // Naming it is the point: "Guardado" over a list you cannot see change
    // is what this screen already had, which was nothing.
    expect(
      await screen.findAllByText(/Creaste la tienda «Lidl»/),
    ).not.toHaveLength(0);
  });

  it("offers a member none of the three things the server refuses", async () => {
    role = "MEMBER";
    renderPage();

    // `store.create`, `store.update` and `store.delete` are all
    // `adminProcedure`. This screen drew all three for everybody, so a member
    // found out by pressing one.
    expect(screen.queryByRole("button", { name: "Crear tienda" })).toBeAbsent();
    expect(screen.queryByRole("button", { name: /Eliminar/ })).toBeAbsent();
    expect(screen.queryByRole("button", { name: /Editar/ })).toBeAbsent();
    expect(
      screen.getByText(/Solo quien administra el hogar/),
    ).toBeInTheDocument();
  });

  it("still offers them to an admin", async () => {
    role = "ADMIN";
    renderPage();

    expect(
      screen.getByRole("button", { name: "Crear tienda" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Solo quien administra el hogar/)).toBeAbsent();
  });

  it("says when a store could not be saved", async () => {
    failure = { data: { code: "INTERNAL_SERVER_ERROR" } };
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Crear tienda" }));
    await userEvent.type(screen.getByLabelText(/Nombre de la tienda/), "Lidl");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    // A failure left the form open with the data still in it and said
    // nothing, so a refused write looked like a form nobody had finished.
    expect(
      await screen.findAllByText(/No se ha podido guardar/),
    ).not.toHaveLength(0);
  });

  it("explains a refused delete only when it knows the reason", async () => {
    failure = { data: { code: "FORBIDDEN" } };
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: /Eliminar Mercadona/ }),
    );

    // "Todavía hay precios o tickets de esa tienda" is true of a CONFLICT and
    // a guess about anything else. It was shown for every failure, so a
    // refused permission was explained as data that does not exist.
    expect(
      await screen.findAllByText(
        /No se ha podido eliminar «Mercadona». Vuelve/,
      ),
    ).not.toHaveLength(0);
    expect(screen.queryByText(/Todavía hay precios/)).toBeAbsent();
  });

  it("keeps the specific sentence for the specific failure", async () => {
    failure = { data: { code: "CONFLICT" } };
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: /Eliminar Mercadona/ }),
    );

    expect(
      await screen.findAllByText(/Todavía hay precios o tickets/),
    ).not.toHaveLength(0);
  });

  it("names the store it deleted, which is in neither the input nor the result", async () => {
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: /Eliminar Mercadona/ }),
    );

    expect(
      await screen.findAllByText(/Eliminaste la tienda «Mercadona»/),
    ).not.toHaveLength(0);
  });

  /**
   * This screen was the only settings sub-page with no way back out of it.
   * `/settings` is the one route that links here, and the compact tiers draw
   * no browser chrome, so leaving it was a gesture rather than a control.
   *
   * The arrow is asserted to be absent from the *name* as well as present in
   * the markup: `BackLink` draws it `aria-hidden`, and the moment a "←" gets
   * typed into the string beside it the reader hears "flecha hacia la
   * izquierda volver a configuración" and the sighted reader sees two.
   */
  it("offers a way back to the settings hub", () => {
    renderPage();

    const back = screen.getByRole("link", { name: "Volver a configuración" });

    expect(back).toHaveAttribute("href", "/settings");
    expect(back.querySelector("svg")).not.toBeNull();
    expect(back.textContent).toBe("Volver a configuración");
  });

  it("offers it to a member too, who can read the shops but not change them", () => {
    role = "MEMBER";
    renderPage();

    expect(
      screen.getByRole("link", { name: "Volver a configuración" }),
    ).toHaveAttribute("href", "/settings");
  });
});
