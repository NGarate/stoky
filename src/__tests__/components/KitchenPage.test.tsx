import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { createContext } from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import type { QueuedOp } from "@/lib/offline/queue";

/**
 * Screen B, the kitchen (`REDESIGN_PLAN.md` §4).
 *
 * An old tablet propped up, read from a metre away, possibly untouched for
 * days. It does one thing — use something up — and everything else on it is
 * for reading.
 */

const enqueue = mock((_op: unknown) => ({ ok: true as const, id: "op-1" }));
const cancel = mock((_id: string) => true);
const createList = mock(
  (
    _input: { name: string },
    opts?: { onSuccess?: (list: { id: string }) => unknown },
  ) => {
    if (createListFails) {
      createListOpts?.onError?.(new Error("offline"));
      return;
    }
    void opts?.onSuccess?.({ id: "l-new" });
  },
);
let createListOpts: { onError?: (e: unknown) => unknown } | undefined;
let createListFails = false;
let listsStub: { data: Array<{ id: string; name: string }> | undefined };

let pending: QueuedOp[] = [];
let expiringStub: Record<string, unknown>;
let stockStub: Record<string, unknown>;

mock.module("@/components/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending, failed: [], status: "idle", full: false },
    enqueue,
    cancel,
    drain: () => {},
    retry: () => {},
    discard: () => {},
    flush: async () => {},
    purgeAll: () => {},
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      invalidate: () => Promise.resolve(),
      shopping: { list: { invalidate: () => Promise.resolve() } },
    }),
    household: {
      create: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
    },
    inventory: {
      getExpiringItems: { useQuery: () => expiringStub },
      getStockOverview: { useQuery: () => stockStub },
    },
    shopping: {
      list: { useQuery: () => listsStub },
      create: {
        useMutation: (opts?: { onError?: (e: unknown) => unknown }) => {
          createListOpts = opts;
          return { mutate: createList, isPending: false };
        },
      },
    },
  },
}));

const { default: KitchenPage } = await import("@/app/(dashboard)/kitchen/page");

function batch(overrides: Record<string, unknown> = {}) {
  return {
    id: "batch-1",
    unit: "L",
    daysUntilExpiry: 2,
    product: { id: "p1", name: "Leche entera" },
    location: { name: "Nevera" },
    ...overrides,
  };
}

function consumeOp(productId: string): QueuedOp {
  return {
    id: "op-pending",
    path: "inventory.consumeStock",
    input: { productId, quantity: 1, unit: "L" },
    householdId: "h1",
    label: { key: "offline.usedUp" },
    createdAt: new Date("2026-08-11T10:00:00.000Z"),
    attempts: 0,
  };
}

beforeEach(() => {
  enqueue.mockClear();
  cancel.mockClear();
  createList.mockClear();
  createListFails = false;
  listsStub = { data: [{ id: "l1", name: "Lista" }] };
  pending = [];
  expiringStub = {
    data: [batch()],
    isPending: false,
    error: null,
    fetchStatus: "idle",
    refetch: () => {},
  };
  stockStub = { data: { products: [] }, isPending: false, error: null };
});

afterEach(cleanup);

describe("what is urgent comes first", () => {
  it("puts anything within three days in 'usar ya'", () => {
    renderWithIntl(<KitchenPage />);

    expect(screen.getByText("Leche entera")).toBeInTheDocument();
    expect(screen.getByText("Quedan 2 días")).toBeInTheDocument();
  });

  it("leaves what is further off in the reading columns", () => {
    expiringStub.data = [batch({ daysUntilExpiry: 6 })];
    renderWithIntl(<KitchenPage />);

    // Nothing urgent means no buttons at all — §4: one button per card, and
    // there are no cards.
    expect(screen.queryByRole("button", { name: /He usado/ })).toBeNull();
    expect(screen.getByText("No hay nada a punto de caducar")).toBeInTheDocument();
  });

  it("says today and tomorrow in words rather than as numbers", () => {
    expiringStub.data = [
      batch({ id: "b1", daysUntilExpiry: 0 }),
      batch({ id: "b2", daysUntilExpiry: 1, product: { id: "p2", name: "Huevos" } }),
    ];
    renderWithIntl(<KitchenPage />);

    expect(screen.getByText("Caduca hoy")).toBeInTheDocument();
    expect(screen.getByText("Caduca mañana")).toBeInTheDocument();
  });

  it("says where it is, or says there is no place set", () => {
    expiringStub.data = [batch({ location: null })];
    renderWithIntl(<KitchenPage />);

    expect(screen.getByText("Sin sitio")).toBeInTheDocument();
  });
});

describe("using something up", () => {
  it("enqueues one unit, so it works on a tablet with no signal", async () => {
    renderWithIntl(<KitchenPage />);

    await userEvent.click(screen.getByRole("button", { name: /He usado un L/ }));

    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      path: "inventory.consumeStock",
      input: { productId: "p1", quantity: 1, unit: "L" },
    });
  });

  it("names the product in the accessible name, not just on the card", () => {
    renderWithIntl(<KitchenPage />);

    // Read from a metre away or not read at all: "He usado uno" alone tells a
    // screen reader nothing about which card it belongs to.
    expect(
      screen.getByRole("button", { name: /He usado un L de Leche entera/ }),
    ).toBeInTheDocument();
  });

  it("offers one action per row and nothing that opens a form", () => {
    // §4 as amended by the owner's pass (D88): a card's tap uses one up, a
    // running-out row's tap writes it on the list. Still no create, edit or
    // delete of products or stock, and still nothing that needs a form.
    stockStub = {
      data: {
        products: [
          { id: "p9", name: "Café", totalStock: 0, minStock: 2, defaultUnit: "ud" },
        ],
      },
      isPending: false,
      error: null,
    };
    renderWithIntl(<KitchenPage />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(document.querySelector("form")).toBeNull();
  });
});

describe("writing it on the list", () => {
  const cafe = {
    id: "p9",
    name: "Café molido",
    totalStock: 0,
    minStock: 2,
    defaultUnit: "paquete",
  };

  beforeEach(() => {
    stockStub = {
      data: { products: [cafe] },
      isPending: false,
      error: null,
    };
  });

  it("enqueues the product onto the newest list, one tap", async () => {
    renderWithIntl(<KitchenPage />);

    await userEvent.click(
      screen.getByRole("button", { name: /Apuntar «Café molido»/ }),
    );

    expect(createList).not.toHaveBeenCalled();
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      path: "shopping.addItem",
      input: {
        shoppingListId: "l1",
        productId: "p9",
        quantity: 1,
        unit: "paquete",
      },
    });
  });

  it("creates the first list with the first tap, and writes onto it", async () => {
    listsStub = { data: [] };
    renderWithIntl(<KitchenPage />);

    await userEvent.click(
      screen.getByRole("button", { name: /Apuntar «Café molido»/ }),
    );

    expect(createList.mock.calls[0]?.[0]).toMatchObject({
      name: "Lista de la cocina",
    });
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      path: "shopping.addItem",
      input: { shoppingListId: "l-new", productId: "p9" },
    });
  });

  it("says so when the first list cannot be created", async () => {
    listsStub = { data: [] };
    createListFails = true;
    renderWithIntl(<KitchenPage />);

    await userEvent.click(
      screen.getByRole("button", { name: /Apuntar «Café molido»/ }),
    );

    expect(enqueue).not.toHaveBeenCalled();
    expect(
      screen.getByText(/no se puede crear la lista/i),
    ).toBeInTheDocument();
  });

  it("offers undo exactly while the add is still queued", async () => {
    pending = [
      {
        id: "op-add",
        path: "shopping.addItem",
        input: { shoppingListId: "l1", productId: "p9", quantity: 1, unit: "paquete" },
        householdId: "h1",
        label: { key: "offline.addedItem" },
        createdAt: new Date("2026-08-18T10:00:00.000Z"),
        attempts: 0,
      },
    ];
    renderWithIntl(<KitchenPage />);

    await userEvent.click(
      screen.getByRole("button", { name: /Quitar «Café molido»/ }),
    );

    expect(cancel).toHaveBeenCalledWith("op-add");
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("undo", () => {
  it("is offered while the change is still waiting to be sent", async () => {
    pending = [consumeOp("p1")];
    renderWithIntl(<KitchenPage />);

    await userEvent.click(screen.getByRole("button", { name: /Deshacer/ }));

    // Cancelling the queued change, never a compensating `addStock` — that
    // would record the household acquiring something it never did, and every
    // downstream reader would see a fabricated event.
    expect(cancel).toHaveBeenCalledWith("op-pending");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("disappears once the change can no longer be taken back", () => {
    pending = [];
    renderWithIntl(<KitchenPage />);

    // More honest than a ten-second timer, which offers undo for ten seconds
    // whether or not pressing it would do anything.
    expect(screen.queryByRole("button", { name: /Deshacer/ })).toBeNull();
  });

  it("belongs to the card whose product is waiting, and no other", () => {
    expiringStub.data = [
      batch({ id: "b1" }),
      batch({ id: "b2", product: { id: "p2", name: "Huevos" } }),
    ];
    pending = [consumeOp("p2")];
    renderWithIntl(<KitchenPage />);

    expect(
      screen.getByRole("button", { name: /Deshacer: Huevos/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deshacer: Leche/ })).toBeNull();
  });
});

describe("what is running out", () => {
  it("says how much is left against the minimum", () => {
    stockStub = {
      data: {
        products: [
          {
            id: "p9",
            name: "Café molido",
            totalStock: 1,
            minStock: 2,
            defaultUnit: "paquete",
          },
        ],
      },
      isPending: false,
      error: null,
    };
    renderWithIntl(<KitchenPage />);

    expect(screen.getByText("Queda 1 de 2 paquete")).toBeInTheDocument();
  });

  it("says plainly when there is none", () => {
    stockStub = {
      data: {
        products: [
          {
            id: "p9",
            name: "Café molido",
            totalStock: 0,
            minStock: 2,
            defaultUnit: "paquete",
          },
        ],
      },
      isPending: false,
      error: null,
    };
    renderWithIntl(<KitchenPage />);

    expect(screen.getByText("No queda nada")).toBeInTheDocument();
  });

  it("counts a queued use against what is left", () => {
    stockStub = {
      data: {
        products: [
          {
            id: "p1",
            name: "Leche entera",
            totalStock: 2,
            minStock: 6,
            defaultUnit: "L",
          },
        ],
      },
      isPending: false,
      error: null,
    };
    pending = [consumeOp("p1")];
    renderWithIntl(<KitchenPage />);

    // Two litres, one used and not yet sent: the tablet must not still say two.
    expect(screen.getByText("Queda 1 de 6 L")).toBeInTheDocument();
  });
});

describe("with no connection and nothing saved", () => {
  it("says so rather than claiming nothing is expiring", () => {
    expiringStub = {
      data: undefined,
      isPending: true,
      error: null,
      fetchStatus: "paused",
      refetch: () => {},
    };
    renderWithIntl(<KitchenPage />);

    expect(
      screen.getByText("Aquí todavía no hay nada guardado"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No hay nada a punto de caducar")).toBeNull();
  });
});
