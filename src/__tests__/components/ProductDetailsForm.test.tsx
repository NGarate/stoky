import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * Editing a product where you are already looking at it.
 *
 * The catalogue fields used to be a read-only list here and a form on a route
 * of its own, so correcting a typo meant leaving the product, losing every
 * other thing the page showed, and coming back.
 */
const updateCalls: unknown[] = [];

/** When true, every `product.update` reports a failure. */
let updateFails = false;
const invalidated: string[] = [];
let barcodeHolder: { id: string; name: string } | null = null;

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
      product: {
        getById: { invalidate: async () => void invalidated.push("getById") },
        list: { invalidate: async () => void invalidated.push("list") },
        getByBarcode: {
          invalidate: async () => void invalidated.push("getByBarcode"),
        },
      },
    }),
    product: {
      getByBarcode: { useQuery: () => ({ data: barcodeHolder }) },
      update: {
        // Two instances now: the save and the restore report differently, so
        // a stub that shares one `opts` would hide which of them ran.
        useMutation: (opts?: {
          onSuccess?: (data: unknown) => void | Promise<void>;
          onError?: () => void;
        }) => ({
          mutate: (input: { name?: string }) => {
            updateCalls.push(input);
            if (updateFails) {
              opts?.onError?.();
              return;
            }
            void opts?.onSuccess?.({ ...input, name: input.name ?? "" });
          },
          isPending: false,
        }),
      },
    },
  },
}));

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const { ProductDetailsForm } =
  await import("@/components/products/ProductDetailsForm");

const product = {
  id: "p1",
  name: "Leche entera",
  brand: "Pascual",
  category: "Lácteos",
  barcode: "8480000123456",
  defaultUnit: "L",
  minStock: 2,
  createdAt: new Date("2026-01-05T10:00:00.000Z"),
};

const render = (canEdit = true) =>
  renderWithIntl(
    <SnackbarProvider>
      <ProductDetailsForm
        canEdit={canEdit}
        formattedDate="5 de enero de 2026"
        product={product}
      />
    </SnackbarProvider>,
    { locale: "es" },
  );

const startEditing = async (): Promise<void> => {
  await userEvent.click(
    screen.getByRole("button", { name: "Editar los datos" }),
  );
};

beforeEach(() => {
  updateCalls.length = 0;
  updateFails = false;
  invalidated.length = 0;
  barcodeHolder = null;
});

afterEach(cleanup);

describe("the product's details", () => {
  it("reads as a list until you ask to change it", () => {
    render();

    expect(screen.getByText("Pascual")).toBeInTheDocument();
    // A catalogue row is read far more often than it is changed, and a screen
    // whose values are always inputs invites a change nobody meant.
    expect(screen.queryByRole("textbox")).toBeAbsent();
  });

  it("offers no way in when the account cannot write", () => {
    render(false);

    // Courtesy, not the control: `writeProcedure` refuses a KITCHEN account
    // whatever this renders.
    expect(
      screen.queryByRole("button", { name: "Editar los datos" }),
    ).toBeAbsent();
  });

  it("prefills every field from the row it is showing", async () => {
    render();
    await startEditing();

    expect(screen.getByLabelText(/Nombre del producto/)).toHaveValue(
      "Leche entera",
    );
    expect(screen.getByLabelText(/Marca/)).toHaveValue("Pascual");
    expect(screen.getByLabelText(/Código de barras/)).toHaveValue(
      "8480000123456",
    );
    expect(screen.getByLabelText(/Stock mínimo/)).toHaveValue(2);
  });

  it("puts the values back when the change is discarded", async () => {
    render();
    await startEditing();

    fireEvent.change(screen.getByLabelText(/Marca/), {
      target: { value: "Otra" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));

    expect(updateCalls).toEqual([]);
    expect(screen.getByText("Pascual")).toBeInTheDocument();
  });

  it("saves the trimmed values, and a blank optional field as null", async () => {
    render();
    await startEditing();

    fireEvent.change(screen.getByLabelText(/Marca/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(updateCalls).toEqual([
      {
        id: "p1",
        name: "Leche entera",
        defaultUnit: "L",
        barcode: "8480000123456",
        // Null, not omitted: `undefined` leaves the column alone and the
        // person meant to clear it.
        brand: null,
        category: "Lácteos",
        minStock: 2,
      },
    ]);
  });

  it("refuses an empty name, and says so where focus lands", async () => {
    render();
    await startEditing();

    fireEvent.change(screen.getByLabelText(/Nombre del producto/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(updateCalls).toEqual([]);
    expect(screen.getByTestId("form-error-summary").textContent).toContain(
      "Escribe el nombre del producto.",
    );
  });

  it("refuses a barcode another product already holds", async () => {
    barcodeHolder = { id: "p2", name: "Leche sin lactosa" };
    render();
    await startEditing();

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(updateCalls).toEqual([]);
    expect(screen.getByTestId("form-error-summary").textContent).toContain(
      "Leche sin lactosa",
    );
  });

  it("does not mistake the product's own barcode for a collision", async () => {
    barcodeHolder = { id: "p1", name: "Leche entera" };
    render();
    await startEditing();

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    // `getByBarcode` finds *this* product when the code has not been touched,
    // and calling that a collision would make every edit look like one.
    expect(updateCalls).toHaveLength(1);
  });

  it("confirms the save, and offers to put the row back as it was", async () => {
    render();
    await startEditing();

    fireEvent.change(screen.getByLabelText(/Marca/), {
      target: { value: "Otra" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      expect(
        screen.getAllByText(/Guardado\. «Leche entera» está al día\./),
      ).not.toHaveLength(0);
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Deshacer" }),
    );

    // An exact inverse exists here and nowhere near stock: the row's previous
    // values are still in hand, so undo restores them rather than writing a
    // compensating anything (D101).
    expect(updateCalls[1]).toEqual({
      id: "p1",
      name: "Leche entera",
      brand: "Pascual",
      category: "Lácteos",
      barcode: "8480000123456",
      defaultUnit: "L",
      minStock: 2,
    });
  });

  it("refetches what the change touched", async () => {
    render();
    await startEditing();
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      expect(invalidated).toContain("getById");
    });
    expect(invalidated).toContain("list");
  });

  for (const locale of ["es", "en"] as const) {
    it(`renders no raw key in ${locale}`, async () => {
      const { container } = renderWithIntl(
        <SnackbarProvider>
          <ProductDetailsForm
            canEdit
            formattedDate="5 de enero de 2026"
            product={product}
          />
        </SnackbarProvider>,
        { locale },
      );

      await userEvent.click(
        screen.getByRole("button", {
          name: locale === "es" ? "Editar los datos" : "Edit the details",
        }),
      );

      expect(container.textContent).not.toContain("products.");
    });
  }
});

describe("undoing a save", () => {
  it("does not offer to undo the undo, which did nothing", async () => {
    render();
    await startEditing();

    fireEvent.change(screen.getByLabelText(/Marca/), {
      target: { value: "Otra" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await userEvent.click(
      await screen.findByRole("button", { name: "Deshacer" }),
    );

    // Restoring used to go through the save's own mutation, so it re-entered
    // that `onSuccess` and produced a second snackbar offering to undo *that*
    // — and by then the previous values had been refetched to the ones just
    // restored, so pressing it did nothing at all.
    await waitFor(() => {
      expect(
        screen.getAllByText(/ha vuelto a como estaba/).length,
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("button", { name: "Deshacer" })).toBeAbsent();
  });

  it("says so when the restore itself is refused", async () => {
    render();
    await startEditing();

    fireEvent.change(screen.getByLabelText(/Marca/), {
      target: { value: "Otra" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    const undo = await screen.findByRole("button", { name: "Deshacer" });
    updateFails = true;
    await userEvent.click(undo);

    // It wrote its message into the form `onDone()` had already closed, where
    // nobody could read it.
    await waitFor(() => {
      expect(
        screen.getAllByText(/No se ha podido deshacer/).length,
      ).toBeGreaterThan(0);
    });
  });
});
