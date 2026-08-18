import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * `/products/[id]/edit` — Phase 8 item 1.
 *
 * `product.update` sat guarded and tested on the server with no screen calling
 * it, and the owner read that absence as a permissions problem. The screen's
 * two behaviours worth pinning are the ones that would silently corrupt data
 * if they regressed:
 *
 * - a blank optional field is sent as `null` (remove), never omitted (keep) —
 *   omission would make "delete this barcode" a no-op that looks like a save;
 * - the duplicate-barcode check exempts the product's own code — without that,
 *   every edit that does not touch the barcode reports a collision with
 *   itself and can never be saved.
 */

interface Holder {
  id: string;
  name: string;
}

const productFixture = {
  id: "p1",
  name: "Leche entera",
  barcode: "8400000000017",
  brand: "Pascual",
  category: null as string | null,
  defaultUnit: "L",
  minStock: 2,
};

let queryStub: {
  data: typeof productFixture | undefined;
  isPending: boolean;
  error: { message: string } | null;
  refetch: () => void;
};
let barcodeHolder: Holder | null;
let updateCalls: Array<Record<string, unknown>>;
let updateOpts: {
  onSuccess?: (product: typeof productFixture) => unknown;
  onError?: (error: { message: string }) => unknown;
};

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      product: {
        getById: { invalidate: () => Promise.resolve() },
        list: { invalidate: () => Promise.resolve() },
        getByBarcode: { invalidate: () => Promise.resolve() },
      },
    }),
    product: {
      getById: { useQuery: () => queryStub },
      getByBarcode: { useQuery: () => ({ data: barcodeHolder }) },
      update: {
        useMutation: (opts: typeof updateOpts) => {
          updateOpts = opts ?? {};
          return {
            mutate: (input: Record<string, unknown>) => {
              updateCalls.push(input);
              void updateOpts.onSuccess?.({
                ...productFixture,
                ...(input as Partial<typeof productFixture>),
              });
            },
            isPending: false,
          };
        },
      },
    },
  },
}));

const { ProductEditView } = await import(
  "@/app/(dashboard)/products/[id]/edit/page"
);

beforeEach(() => {
  queryStub = {
    data: productFixture,
    isPending: false,
    error: null,
    refetch: () => {},
  };
  barcodeHolder = null;
  updateCalls = [];
  updateOpts = {};
});

afterEach(cleanup);

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe("the edit screen", () => {
  it("prefills every field from the catalogue", () => {
    renderWithIntl(<ProductEditView id="p1" />, { locale: "es" });

    expect(field("Nombre del producto").value).toBe("Leche entera");
    expect(field("Código de barras (opcional)").value).toBe("8400000000017");
    expect(field("Marca (opcional)").value).toBe("Pascual");
    expect(field("Categoría (opcional)").value).toBe("");
    expect(field("Unidad por defecto").value).toBe("L");
    expect(field("Stock mínimo (opcional)").value).toBe("2");
  });

  it("saves trimmed values, and a blank optional field as null — not omitted", async () => {
    renderWithIntl(<ProductEditView id="p1" />, { locale: "es" });

    fireEvent.change(field("Nombre del producto"), {
      target: { value: "  Leche semidesnatada  " },
    });
    fireEvent.change(field("Código de barras (opcional)"), {
      target: { value: "" },
    });
    fireEvent.change(field("Marca (opcional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(updateCalls).toEqual([
      {
        id: "p1",
        name: "Leche semidesnatada",
        defaultUnit: "L",
        barcode: null,
        brand: null,
        category: null,
        minStock: 2,
      },
    ]);

    // A11Y-1's rule: the save says so where assistive tech can hear it.
    const saved = await screen.findByText(
      "Guardado. «Leche semidesnatada» está al día.",
    );
    expect(saved.closest("[role='status']")).not.toBeNull();
  });

  it("refuses a barcode another product holds, and says whose it is", () => {
    barcodeHolder = { id: "p2", name: "Leche sin lactosa" };
    renderWithIntl(<ProductEditView id="p1" />, { locale: "es" });

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(updateCalls).toEqual([]);
    expect(
      screen.getAllByText(/Leche sin lactosa/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("does not mistake the product's own barcode for a collision", () => {
    // `getByBarcode` answers with the product being edited — the code was
    // never touched. Treating that as taken would make every edit unsavable.
    barcodeHolder = { id: "p1", name: "Leche entera" };
    renderWithIntl(<ProductEditView id="p1" />, { locale: "es" });

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(updateCalls.length).toBe(1);
  });

  it("refuses to save without a name", () => {
    renderWithIntl(<ProductEditView id="p1" />, { locale: "es" });

    fireEvent.change(field("Nombre del producto"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(updateCalls).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain(
      "Escribe el nombre del producto.",
    );
  });

  for (const locale of ["es", "en"] as const) {
    it(`renders no raw key in ${locale}`, () => {
      const { container } = renderWithIntl(<ProductEditView id="p1" />, {
        locale,
      });

      expect(container.textContent).not.toContain("products.");
    });
  }
});
