import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";
import { Decimal } from "@prisma/client-runtime-utils";

/**
 * The delete section on `/products/[id]` — Phase 8 item 5, D90.
 *
 * Four rules, each pinned: only an administrator sees it (courtesy — the
 * middleware is the control); a product with any ledger shows why it cannot
 * go instead of a button; the button never fires on the first press; and a
 * CONFLICT from the server's four-way count arrives as a sentence about
 * references, not as a raw error.
 */
let role: "OWNER" | "ADMIN" | "MEMBER";
let stockEntries: unknown[];
let deleteCalls: Array<Record<string, unknown>>;
let deleteFails: string | null;

const product = () => ({
  id: "p1",
  name: "Sal fina",
  brand: null,
  category: null,
  barcode: null,
  imageUrl: null,
  defaultUnit: "kg",
  minStock: null,
  totalStock: new Decimal(0),
  openFoodFactsData: null,
  createdAt: new Date("2026-08-01T10:00:00Z"),
  stockEntries,
  priceRecords: [],
});

const replaceCalls: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => replaceCalls.push(href),
    push: () => {},
    refresh: () => {},
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/products/p1",
  useParams: () => ({}),
  redirect: () => {},
}));

// The real snackbar rather than a stub of it: `mock.module` replaces a module
// for the whole bun process, so stubbing this one reaches every other suite
// that renders the real provider.
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
      product: { list: { invalidate: () => Promise.resolve() } },
    }),
    auth: {
      me: {
        useQuery: () => ({ data: { role }, isPending: false, error: null }),
      },
    },
    product: {
      getById: {
        useQuery: () => ({
          data: product(),
          isPending: false,
          error: null,
          refetch: () => {},
        }),
      },
      delete: {
        useMutation: (opts?: {
          onSuccess?: () => unknown;
          onError?: (error: { message: string }) => unknown;
        }) => ({
          mutate: (input: Record<string, unknown>) => {
            deleteCalls.push(input);
            if (deleteFails) opts?.onError?.({ message: deleteFails });
            else void opts?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const { ProductDetailView } =
  await import("@/app/(dashboard)/products/[id]/page");

function render() {
  return renderWithIntl(
    <SnackbarProvider>
      <ProductDetailView id="p1" />
    </SnackbarProvider>,
    { locale: "es" },
  );
}

beforeEach(() => {
  role = "ADMIN";
  stockEntries = [];
  deleteCalls = [];
  deleteFails = null;
  replaceCalls.length = 0;
});

afterEach(cleanup);

describe("deleting a product", () => {
  it("is offered to administrators only", () => {
    role = "MEMBER";
    render();

    expect(screen.queryByText("Eliminar el producto")).toBeAbsent();
  });

  it("explains itself instead of offering a button when the ledger is not empty", () => {
    stockEntries = [
      {
        id: "e1",
        quantity: new Decimal(1),
        unit: "kg",
        location: null,
        expirationDate: null,
        createdAt: new Date(),
      },
    ];
    render();

    expect(screen.getByText(/tiene historial/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Eliminar el producto" }),
    ).toBeAbsent();
  });

  it("draws the trigger as a destructive word and only the confirmation in red", () => {
    render();

    // All three were the primary fill: "Eliminar el producto", "Sí, eliminar
    // definitivamente" and "Cancelar" looked the same as "Guardar".
    const trigger = screen.getByRole("button", {
      name: "Eliminar el producto",
    });
    expect(trigger.className).toContain("text-destructive");
    expect(trigger.className).not.toContain("bg-primary");

    fireEvent.click(trigger);
    expect(
      screen.getByRole("button", { name: "Sí, eliminar definitivamente" })
        .className,
    ).toContain("bg-destructive");
    expect(
      screen.getByRole("button", { name: "Cancelar" }).className,
    ).not.toContain("bg-primary");
  });

  it("never fires on the first press — the second one names the product", () => {
    render();

    fireEvent.click(
      screen.getByRole("button", { name: "Eliminar el producto" }),
    );
    expect(deleteCalls).toEqual([]);

    fireEvent.click(
      screen.getByRole("button", { name: "Sí, eliminar definitivamente" }),
    );
    expect(deleteCalls).toEqual([{ id: "p1" }]);

    // The page describes a product that no longer exists, so it leaves and
    // the sentence travels with it. The snackbar is mounted above every
    // route, which is what lets a confirmation outlive the screen that
    // produced it.
    expect(replaceCalls).toEqual(["/products"]);
    expect(
      screen.getAllByText("«Sal fina» ya no está en el catálogo."),
    ).not.toHaveLength(0);
  });

  it("turns the server's four-way CONFLICT into a sentence about references", () => {
    deleteFails =
      "This product still has 3 price records. Remove those first, or keep the product.";
    render();

    fireEvent.click(
      screen.getByRole("button", { name: "Eliminar el producto" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Sí, eliminar definitivamente" }),
    );

    expect(screen.getByText(/precios, líneas de ticket/)).toBeInTheDocument();
    // A refusal leaves you where you were, with the reason on the screen.
    expect(replaceCalls).toEqual([]);
    expect(screen.queryAllByText(/ya no está en el catálogo/)).toHaveLength(0);
  });
});
