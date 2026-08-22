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

function mutation(record: unknown[], result?: unknown) {
  return {
    useMutation: (opts?: { onSuccess?: (data: unknown) => void | Promise<void> }) => ({
      mutate: (
        input: unknown,
        perCall?: { onSuccess?: (data: unknown) => void | Promise<void> },
      ) => {
        record.push(input);
        void opts?.onSuccess?.(result);
        // Delete carries no name in its input or result, so the page passes
        // its callbacks per call — where the row still knows which store it is.
        void perCall?.onSuccess?.(result);
      },
      isPending: false,
    }),
  };
}

// The real snackbar rather than a stub: `mock.module` replaces a module for
// the whole bun process, so stubbing it here would also replace the component
// `Snackbar.test.tsx` renders.
mock.module("@/components/offline/queue-context", () => ({
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
      store: { list: { invalidate: async () => void invalidated.push("store.list") } },
    }),
    store: {
      list: { useQuery: () => ({ data: stores, isLoading: false }) },
      create: mutation(createCalls, { id: "s2", name: "Lidl" }),
      update: mutation([], { id: "s1", name: "Mercadona" }),
      delete: mutation(deleteCalls),
    },
  },
}));

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const StoresPage = (await import("@/app/(dashboard)/settings/stores/page")).default;

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

  it("refetches the list after deleting one", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Eliminar Mercadona/ }));

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
    expect(await screen.findAllByText(/Creaste la tienda «Lidl»/)).not.toHaveLength(0);
  });

  it("names the store it deleted, which is in neither the input nor the result", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /Eliminar Mercadona/ }));

    expect(
      await screen.findAllByText(/Eliminaste la tienda «Mercadona»/),
    ).not.toHaveLength(0);
  });
});
