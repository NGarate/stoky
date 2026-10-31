import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";

/**
 * Scanning to choose a product: a known code comes back as the product, and
 * an unknown one is a question with three answers.
 *
 * The camera is driven through the typed-code field, which takes the same
 * path as a decoded frame; the camera itself is `Scanner.test.tsx`'s.
 */

const MILK = {
  id: "p1",
  name: "Leche entera",
  brand: "Granja",
  defaultUnit: "L",
  barcode: "8410000000123",
};

let lookupFails = false;
let offFinds: typeof MILK | null = null;
const created: Array<Record<string, unknown>> = [];
const lookedUp: string[] = [];

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      product: {
        invalidate: async () => {},
        getByBarcode: {
          fetch: async ({ barcode }: { barcode: string }) => {
            if (lookupFails) throw new Error("offline");
            return barcode === MILK.barcode ? MILK : null;
          },
        },
      },
    }),
    product: {
      scanBarcode: {
        useMutation: (options: {
          onSuccess: (result: unknown) => Promise<void>;
        }) => ({
          isPending: false,
          mutate: ({ barcode }: { barcode: string }) => {
            lookedUp.push(barcode);
            void options.onSuccess(
              offFinds
                ? { product: offFinds, source: "open_food_facts" }
                : { product: null, source: "not_found" },
            );
          },
        }),
      },
      create: {
        useMutation: (options: {
          onSuccess: (product: unknown) => Promise<void>;
        }) => ({
          isPending: false,
          mutate: (input: { name: string; barcode: string }) => {
            created.push(input);
            void options.onSuccess({
              id: "new",
              name: input.name,
              brand: null,
              defaultUnit: "unit",
              barcode: input.barcode,
            });
          },
        }),
      },
    },
  },
  TRPCProvider: ({ children }: { children: unknown }) => children,
}));

// Pending for ever, as a permission prompt holds it: no camera here.
mock.module("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints() {
      return new Promise(() => {});
    }
  },
}));

const { ScanProductDialog } =
  await import("@/components/barcode/ScanProductDialog");

beforeEach(() => {
  lookupFails = false;
  offFinds = null;
  created.length = 0;
  lookedUp.length = 0;
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
});

afterEach(cleanup);

function open(onAssign?: (code: string) => void) {
  const onFound = mock((_product: unknown) => {});
  const onClose = mock(() => {});
  renderWithIntl(
    <ScanProductDialog
      onAssign={onAssign}
      onClose={onClose}
      onFound={onFound}
      open
    />,
  );
  return { onFound, onClose };
}

async function enter(code: string): Promise<void> {
  await userEvent.type(
    screen.getByLabelText("¿No lo lee? Escribe el código"),
    code,
  );
  await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
}

describe("ScanProductDialog", () => {
  it("hands back the product a known code belongs to, and closes", async () => {
    const { onFound, onClose } = open();

    await enter(MILK.barcode);

    await waitFor(() => {
      expect(onFound).toHaveBeenCalledWith({
        id: "p1",
        name: "Leche entera",
        brand: "Granja",
        defaultUnit: "L",
      });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("asks what an unknown code is, naming it", async () => {
    open();

    await enter("5000000000001");

    expect(
      await screen.findByRole("heading", {
        name: "Ningún producto de tu hogar tiene el código 5000000000001",
      }),
    ).toBeInTheDocument();
  });

  it("creates the product with the code already on it", async () => {
    const { onFound } = open();
    await enter("5000000000001");

    await userEvent.type(
      await screen.findByLabelText("Nombre del producto nuevo"),
      "Galletas",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Crear con este código" }),
    );

    expect(created).toEqual([{ name: "Galletas", barcode: "5000000000001" }]);
    await waitFor(() => {
      expect(onFound).toHaveBeenCalledWith(
        expect.objectContaining({ id: "new", name: "Galletas" }),
      );
    });
  });

  it("takes what Open Food Facts knows, when it knows it", async () => {
    offFinds = { ...MILK, id: "off", name: "Galletas María" };
    const { onFound } = open();
    await enter("5000000000001");

    await userEvent.click(
      await screen.findByRole("button", { name: "Buscar en Open Food Facts" }),
    );

    expect(lookedUp).toEqual(["5000000000001"]);
    await waitFor(() => {
      expect(onFound).toHaveBeenCalledWith(
        expect.objectContaining({ id: "off" }),
      );
    });
  });

  it("says when Open Food Facts does not know it either, and stops offering it", async () => {
    const { onFound } = open();
    await enter("5000000000001");

    await userEvent.click(
      await screen.findByRole("button", { name: "Buscar en Open Food Facts" }),
    );

    expect(
      await screen.findByText(/Open Food Facts tampoco lo conoce/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Buscar en Open Food Facts" }),
    ).toBeAbsent();
    expect(onFound).not.toHaveBeenCalled();
  });

  it("hands an unknown code to the caller to place on an existing product", async () => {
    const onAssign = mock((_code: string) => {});
    const { onClose } = open(onAssign);
    await enter("5000000000001");

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Es un producto que ya tengo",
      }),
    );

    expect(onAssign).toHaveBeenCalledWith("5000000000001");
    expect(onClose).toHaveBeenCalled();
  });

  it("does not offer that answer to a caller that cannot take it", async () => {
    open();
    await enter("5000000000001");

    await screen.findByLabelText("Nombre del producto nuevo");
    expect(
      screen.queryByRole("button", { name: "Es un producto que ya tengo" }),
    ).toBeAbsent();
  });

  it("says the lookup failed and offers it again, rather than calling the code unknown", async () => {
    lookupFails = true;
    open();
    await enter(MILK.barcode);

    expect(
      await screen.findByText(/No se ha podido buscar el código/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre del producto nuevo")).toBeAbsent();
    expect(
      screen.getByRole("button", { name: "Volver a buscar" }),
    ).toBeInTheDocument();
  });
});
