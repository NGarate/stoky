import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl, esMessages, enMessages } from "../utils/render";

/**
 * ISSUES.md UI-3 item 8 — the picker used to tell people the wrong verb.
 *
 * It read `useTranslations("inventory.add")` outright, and both stock screens
 * render it. So `/inventory/consume` — a page about things being used up — said
 * "Elige el producto al que quieres **añadir** stock". Confirmed in a browser
 * at the time, and invisible to every test, because the string was a correct
 * translation of the wrong sentence: `messages.test.ts` compares catalogues to
 * each other, and nothing compared a sentence to the page it was on.
 *
 * The labels that are the same wherever the picker appears now live in
 * `inventory.picker`; the one sentence that depends on what the page is for is
 * a prop. So what is worth testing is that the prop reaches the screen and that
 * the labels no longer come from one particular page's namespace.
 */

const MILK = {
  id: "p1",
  name: "Leche entera",
  brand: null,
  defaultUnit: "L",
  barcode: "8410000000123",
};
const BREAD = {
  id: "p2",
  name: "Pan",
  brand: null,
  defaultUnit: "unit",
  barcode: null,
};
const updates: Array<Record<string, unknown>> = [];

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      product: {
        invalidate: async () => {},
        getByBarcode: {
          fetch: async ({ barcode }: { barcode: string }) =>
            barcode === MILK.barcode ? MILK : null,
        },
      },
    }),
    product: {
      list: {
        useQuery: () => ({
          data: { products: [MILK, BREAD] },
          isPending: false,
        }),
      },
      update: {
        useMutation: (options: {
          onSuccess: (data: unknown, variables: { barcode?: string }) => void;
        }) => ({
          isPending: false,
          mutate: (input: { id: string; barcode: string }) => {
            updates.push(input);
            options.onSuccess({}, input);
          },
        }),
      },
      scanBarcode: { useMutation: () => ({ isPending: false, mutate() {} }) },
      create: { useMutation: () => ({ isPending: false, mutate() {} }) },
    },
  },
  TRPCProvider: ({ children }: { children: unknown }) => children,
}));

mock.module("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints() {
      return new Promise(() => {});
    }
  },
}));

const { ProductPicker } = await import("@/components/inventory/ProductPicker");

afterEach(cleanup);

describe("the sentence under the field", () => {
  it("is whatever the page supplied", () => {
    renderWithIntl(
      <ProductPicker
        hint="Elige el producto que se ha gastado."
        value=""
        onChange={() => {}}
      />,
    );

    expect(
      screen.getByText("Elige el producto que se ha gastado."),
    ).toBeInTheDocument();
  });

  it("is not the add page's, whatever page this is", () => {
    // The defect exactly: the consume page rendered the add page's verb.
    const { container } = renderWithIntl(
      <ProductPicker
        hint="Elige el producto que se ha gastado."
        value=""
        onChange={() => {}}
      />,
    );

    expect(container.textContent).not.toContain("añadir stock");
  });
});

describe("the labels that do not depend on the page", () => {
  it("comes from the shared namespace", () => {
    renderWithIntl(<ProductPicker hint="—" value="" onChange={() => {}} />);

    expect(screen.getByLabelText("Buscar producto")).toBeInTheDocument();
    expect(screen.getByLabelText("Producto")).toBeInTheDocument();
  });

  it("is translated", () => {
    renderWithIntl(<ProductPicker hint="—" value="" onChange={() => {}} />, {
      locale: "en",
    });

    expect(screen.getByLabelText("Search for a product")).toBeInTheDocument();
  });
});

describe("the catalogue behind it", () => {
  it("gives each stock screen its own sentence", () => {
    // The two hints must actually differ, in both languages. Two identical
    // strings in two namespaces would pass every test above and be the same bug
    // with more indirection.
    for (const catalogue of [esMessages, enMessages]) {
      const inventory = catalogue.inventory as unknown as Record<
        string,
        Record<string, string>
      >;

      expect(inventory.add.productSelectHint).not.toBe(
        inventory.consume.productSelectHint,
      );
    }
  });

  it("keeps the shared labels out of either page's namespace", () => {
    // Otherwise the next person copies the old pattern and the picker starts
    // reading one page's keys again.
    for (const catalogue of [esMessages, enMessages]) {
      const inventory = catalogue.inventory as unknown as Record<
        string,
        unknown
      >;

      expect(inventory.picker).toBeDefined();
      expect(inventory.add).not.toHaveProperty("productSearchLabel");
      expect(inventory.consume).not.toHaveProperty("productSearchLabel");
    }
  });
});

describe("a code typed into the search", () => {
  it("chooses the product that carries it, as a hand scanner types it", async () => {
    const onChange = mock((_product: unknown) => {});
    renderWithIntl(<ProductPicker hint="" onChange={onChange} value="" />);

    await userEvent.type(
      screen.getByLabelText("Buscar producto"),
      "8410000000123",
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        id: "p1",
        name: "Leche entera",
        brand: null,
        defaultUnit: "L",
      });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("chooses nothing for a name, which is only a filter", async () => {
    const onChange = mock((_product: unknown) => {});
    renderWithIntl(<ProductPicker hint="" onChange={onChange} value="" />);

    await userEvent.type(screen.getByLabelText("Buscar producto"), "Leche");

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("scanning from the picker", () => {
  async function scanCode(code: string): Promise<void> {
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    await userEvent.click(screen.getByRole("button", { name: "Escanear" }));
    await userEvent.type(
      screen.getByLabelText("¿No lo lee? Escribe el código"),
      code,
    );
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
  }

  it("chooses the product a scanned code belongs to", async () => {
    const onChange = mock((_product: unknown) => {});
    renderWithIntl(<ProductPicker hint="" onChange={onChange} value="" />);

    await scanCode(MILK.barcode);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        id: "p1",
        name: "Leche entera",
        brand: null,
        defaultUnit: "L",
      });
    });
    expect(screen.queryByRole("dialog")).toBeAbsent();
  });

  it("keeps its own searches out of the form it sits in", async () => {
    const submitted = mock(() => {});
    renderWithIntl(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted();
        }}
      >
        <ProductPicker hint="" onChange={() => {}} value="" />
      </form>,
    );

    await scanCode("5000000000001");
    await userEvent.type(
      await screen.findByLabelText("Nombre del producto nuevo"),
      "Galletas",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Crear con este código" }),
    );

    // The add-stock and shopping forms hold this picker; looking a code up
    // must not save stock or a shopping line.
    expect(submitted).not.toHaveBeenCalled();
  });

  it("saves an unknown code onto the product chosen for it, when asked", async () => {
    updates.length = 0;
    const { rerender } = renderWithIntl(
      <ProductPicker hint="" onChange={() => {}} value="" />,
    );

    await scanCode("5000000000001");
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Es un producto que ya tengo",
      }),
    );

    expect(
      screen.getByText(
        "Elige a qué producto pertenece el código 5000000000001.",
      ),
    ).toBeInTheDocument();
    // Nothing is saved by choosing; it waits for the explicit button.
    rerender(<ProductPicker hint="" onChange={() => {}} value="p2" />);
    expect(updates).toEqual([]);

    await userEvent.click(
      screen.getByRole("button", { name: "Guardar el código en «Pan»" }),
    );

    expect(updates).toEqual([{ id: "p2", barcode: "5000000000001" }]);
    expect(
      await screen.findByText("El código 5000000000001 es ahora de «Pan»."),
    ).toBeInTheDocument();
  });

  it("warns that saving replaces the code a product already has", async () => {
    const { rerender } = renderWithIntl(
      <ProductPicker hint="" onChange={() => {}} value="" />,
    );
    await scanCode("5000000000001");
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Es un producto que ya tengo",
      }),
    );

    rerender(<ProductPicker hint="" onChange={() => {}} value="p1" />);

    expect(
      screen.getByText(
        "«Leche entera» ya tiene el código 8410000000123; se sustituirá.",
      ),
    ).toBeInTheDocument();
  });
});
