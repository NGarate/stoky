import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function mutation(record: unknown[]) {
  return {
    useMutation: (opts?: { onSuccess?: () => void | Promise<void> }) => ({
      mutate: (input: unknown) => {
        record.push(input);
        void opts?.onSuccess?.();
      },
      isPending: false,
    }),
  };
}

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      store: { list: { invalidate: async () => void invalidated.push("store.list") } },
    }),
    store: {
      list: { useQuery: () => ({ data: stores, isLoading: false }) },
      create: mutation(createCalls),
      update: mutation([]),
      delete: mutation(deleteCalls),
    },
  },
}));

const StoresPage = (await import("@/app/(dashboard)/settings/stores/page")).default;

beforeEach(() => {
  invalidated.length = 0;
  createCalls.length = 0;
  deleteCalls.length = 0;
});

afterEach(cleanup);

describe("the stores settings screen", () => {
  it("refetches the list after creating a store", async () => {
    renderWithIntl(<StoresPage />, { locale: "es" });

    await userEvent.click(screen.getByRole("button", { name: "Crear tienda" }));
    await userEvent.type(screen.getByLabelText(/Nombre de la tienda/), "Lidl");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    // Without this the new store does not appear until the route is left and
    // re-entered, and the form closing is the only sign anything happened.
    expect(invalidated).toContain("store.list");
  });

  it("refetches the list after deleting one", async () => {
    renderWithIntl(<StoresPage />, { locale: "es" });

    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(deleteCalls).toHaveLength(1);
    expect(invalidated).toContain("store.list");
  });
});
