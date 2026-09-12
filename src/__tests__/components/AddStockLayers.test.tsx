import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * `/inventory/add` in two layers — Phase 8 item 3.
 *
 * The behaviours worth money:
 * - store and price ride the same `addStock` call the server has accepted
 *   since SEC-1's fix — a price without a store is refused at the edge with
 *   the fix named, because the server would accept it and silently record
 *   nothing;
 * - the location stays blank until explicitly chosen;
 * - unit, location and note live behind a disclosure that a unit error can
 *   open — an error pointing into a closed drawer is a locked door.
 */

const entries = [
  { locationId: "nevera", quantity: 6, createdAt: new Date("2026-08-01") },
  { locationId: "nevera", quantity: 4, createdAt: new Date("2026-08-05") },
  { locationId: "despensa", quantity: 2, createdAt: new Date("2026-08-10") },
];

let addStockCalls: Array<Record<string, unknown>>;

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/inventory/add",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: () => {},
}));

mock.module("@/components/offline/Composer", () => ({
  // Complete mock, per D50 — the page uses only useEnvelope, but a partial
  // module mock nulls the other exports for every later file in the run.
  ComposerContext: createContext(null),
  ComposerProvider: ({ children }: { children: React.ReactNode }) => children,
  useComposer: () => ({ userId: "u1", householdId: "h1" }),
  useEnvelope: () => () => ({
    idempotencyKey: "test-key",
    composedByUserId: "u1",
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      inventory: { getStockOverview: { invalidate: () => Promise.resolve() } },
    }),
    product: {
      list: {
        useQuery: () => ({
          data: {
            products: [
              { id: "p1", name: "Leche entera", defaultUnit: "L" },
            ],
          },
          isPending: false,
        }),
      },
      getById: {
        useQuery: () => ({
          data: { id: "p1", stockEntries: entries },
          isPending: false,
          error: null,
        }),
      },
    },
    location: {
      list: {
        useQuery: () => ({
          data: [
            { id: "nevera", name: "Nevera", parentId: null },
            { id: "despensa", name: "Despensa", parentId: null },
          ],
          isLoading: false,
        }),
      },
    },
    store: {
      list: {
        useQuery: () => ({
          data: [{ id: "s1", name: "Mercadona" }],
          isLoading: false,
        }),
      },
    },
    inventory: {
      addStock: {
        useMutation: () => ({
          mutate: (input: Record<string, unknown>) => {
            addStockCalls.push(input);
          },
          isPending: false,
        }),
      },
    },
  },
}));

const { default: AddStockPage } = await import(
  "@/app/(dashboard)/inventory/add/page"
);

beforeEach(() => {
  addStockCalls = [];
});

afterEach(cleanup);

function pickProduct(): void {
  fireEvent.change(screen.getByLabelText("Producto"), {
    target: { value: "p1" },
  });
}

describe("the add form in two layers", () => {
  it("keeps unit, location and note behind the disclosure", () => {
    renderWithIntl(<AddStockPage />, { locale: "es" });

    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    // The folded fields live inside it; the essentials do not.
    expect(details?.textContent).toContain("Unidad");
    expect(details?.textContent).toContain("Ubicación");
    expect(details?.textContent).toContain("Nota");
    expect(details?.textContent).not.toContain("Precio");
  });

  it("sends store and price with the same save", () => {
    renderWithIntl(<AddStockPage />, { locale: "es" });

    pickProduct();
    fireEvent.change(screen.getByLabelText("Cantidad"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Tienda (opcional)"), {
      target: { value: "s1" },
    });
    fireEvent.change(screen.getByLabelText("Precio (opcional)"), {
      target: { value: "3.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Añadir stock" }));

    expect(addStockCalls.length).toBe(1);
    expect(addStockCalls[0]).toMatchObject({
      productId: "p1",
      quantity: 2,
      unit: "L",
      storeId: "s1",
      price: 3.5,
    });
  });

  it("refuses a price without a store, naming the fix", () => {
    renderWithIntl(<AddStockPage />, { locale: "es" });

    pickProduct();
    fireEvent.change(screen.getByLabelText("Cantidad"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Precio (opcional)"), {
      target: { value: "3.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Añadir stock" }));

    expect(addStockCalls).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain(
      "Para guardar el precio, elige también la tienda.",
    );
  });

  it("leaves unprovided stock details blank despite the purchase history", () => {
    renderWithIntl(<AddStockPage />, { locale: "es" });

    pickProduct();
    fireEvent.change(screen.getByLabelText("Cantidad"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Añadir stock" }));

    // Past purchases do not tell us where this new unit was put.
    expect(addStockCalls.length).toBe(1);
    expect(addStockCalls[0]?.locationId).toBeUndefined();
    expect(addStockCalls[0]?.expirationDate).toBeUndefined();
    expect(addStockCalls[0]?.note).toBeUndefined();
  });
});
