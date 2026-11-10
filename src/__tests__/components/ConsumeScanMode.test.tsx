import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Decimal } from "@prisma/client-runtime-utils";
import { renderWithIntl } from "../utils/render";

/**
 * Scan mode on `/inventory/consume`: a scanned product is recorded as used at
 * once — after the stock figure the form checks against has arrived, since
 * saving before it would skip the "not enough" check.
 */

let consumed: Array<Record<string, unknown>>;
/** Whether the stock figure has arrived. */
let stockPending: boolean;

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/inventory/consume",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: () => {},
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      inventory: { invalidate: async () => {} },
      product: { invalidate: async () => {} },
      shopping: { invalidate: async () => {} },
    }),
    product: {
      list: {
        useQuery: () => ({
          data: {
            products: [
              {
                id: "p1",
                name: "Leche entera",
                brand: null,
                defaultUnit: "L",
                barcode: "8410000000123",
              },
            ],
          },
          isPending: false,
        }),
      },
      getById: {
        useQuery: (_input: unknown, options: { enabled: boolean }) =>
          options.enabled && !stockPending
            ? {
                data: { id: "p1", totalStock: new Decimal(5) },
                isPending: false,
              }
            : { data: undefined, isPending: true },
      },
      scanBarcode: { useMutation: () => ({ isPending: false, mutate() {} }) },
      create: { useMutation: () => ({ isPending: false, mutate() {} }) },
    },
    location: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    inventory: {
      consumeStock: {
        useMutation: () => ({
          isPending: false,
          mutate: (input: Record<string, unknown>) => consumed.push(input),
        }),
      },
    },
  },
}));

mock.module("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints() {
      return new Promise(() => {});
    }
  },
}));

const { default: ConsumePage } =
  await import("@/app/(dashboard)/inventory/consume/page");

beforeEach(() => {
  consumed = [];
  stockPending = false;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function scanInScanMode(): Promise<void> {
  await userEvent.click(screen.getByLabelText("Modo escaneo"));
  await userEvent.type(
    screen.getByLabelText("Buscar producto"),
    "8410000000123",
  );
}

describe("scan mode on the consume screen", () => {
  it("records one of a scanned product as used, at once", async () => {
    renderWithIntl(<ConsumePage />, { locale: "es" });

    await scanInScanMode();

    await waitFor(() => {
      expect(consumed).toHaveLength(1);
    });
    expect(consumed[0]).toMatchObject({ productId: "p1", unit: "L" });
    expect(Math.abs(consumed[0]?.quantity as number)).toBe(1);
  });

  it("waits for the stock figure before saving", async () => {
    stockPending = true;
    const { rerender } = renderWithIntl(<ConsumePage />, { locale: "es" });

    await scanInScanMode();
    await waitFor(() => {
      expect(screen.getByLabelText("Producto")).toHaveValue("p1");
    });
    expect(consumed).toHaveLength(0);

    stockPending = false;
    rerender(<ConsumePage />);

    await waitFor(() => {
      expect(consumed).toHaveLength(1);
    });
  });
});
