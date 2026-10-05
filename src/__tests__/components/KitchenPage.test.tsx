import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { createContext } from "react";
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import type { QueuedOp, EnqueueResult } from "@/lib/offline/queue";

/**
 * Screen B, the kitchen (`REDESIGN_PLAN.md` §4).
 *
 * An old tablet propped up, read from a metre away, possibly untouched for
 * days. It does one thing — use something up — and everything else on it is
 * for reading.
 */

// Typed as the real result so a test can make the queue refuse a change.
const enqueue = mock(
  (_op: unknown): EnqueueResult => ({ ok: true, id: "op-1" }),
);
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
    if (createListHeld) {
      // The request is still out: answered later by `answerCreateList`.
      answerCreateList = () => void opts?.onSuccess?.({ id: "l-new" });
      return;
    }
    void opts?.onSuccess?.({ id: "l-new" });
  },
);
let createListOpts: { onError?: (e: unknown) => unknown } | undefined;
let createListFails = false;
/** Whether the create request stays unanswered until the test answers it. */
let createListHeld = false;
let answerCreateList: () => void = () => {};
let listsStub: { data: Array<{ id: string; name: string }> | undefined };

let pending: QueuedOp[] = [];
let expiringStub: Record<string, unknown>;
let stockStub: Record<string, unknown>;

mock.module("@/lib/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending, failed: [], status: "idle", full: false },
    enqueue,
    cancel,
    // The snackbar asks how long its change can still be taken back.
    holdRemainingMs: () => 10_000,
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

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const { default: KitchenPage } = await import("@/app/(dashboard)/kitchen/page");

/**
 * The real snackbar, not a stub of it.
 *
 * `mock.module` replaces a module for the whole bun process, so stubbing
 * this one reached every other suite that renders the real provider — which
 * is how three unrelated files went red at once. Rendering it for real is
 * immune to that and asserts more: that the sentence reaches the screen and
 * that pressing Deshacer cancels the right change, rather than that a
 * function was called with an object.
 */
const renderKitchen = () =>
  renderWithIntl(
    <SnackbarProvider>
      <KitchenPage />
    </SnackbarProvider>,
  );

function batch(overrides: Record<string, unknown> = {}) {
  return {
    id: "batch-1",
    quantity: 3,
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
  createListHeld = false;
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
    renderKitchen();

    expect(screen.getByText("Leche entera")).toBeInTheDocument();
    // `ExpiryStatus`'s words — the kitchen said "Quedan 2 días" while the
    // Panel said "En 2 días" for the same batch.
    expect(screen.getByText("Caduca en 2 días")).toBeInTheDocument();
  });

  it("leaves what is further off in the reading columns", () => {
    expiringStub.data = [batch({ daysUntilExpiry: 6 })];
    renderKitchen();

    // Nothing urgent means no buttons at all — §4: one button per card, and
    // there are no cards.
    expect(screen.queryByRole("button", { name: /He usado/ })).toBeAbsent();
    expect(screen.getByText("No hay nada a punto de caducar")).toBeInTheDocument();
  });

  it("says today and tomorrow in words rather than as numbers", () => {
    expiringStub.data = [
      batch({ id: "b1", daysUntilExpiry: 0 }),
      batch({ id: "b2", daysUntilExpiry: 1, product: { id: "p2", name: "Huevos" } }),
    ];
    renderKitchen();

    expect(screen.getByText("Caduca hoy")).toBeInTheDocument();
    expect(screen.getByText("Caduca mañana")).toBeInTheDocument();
  });

  it("says where it is, or says there is no place set", () => {
    expiringStub.data = [batch({ location: null })];
    renderKitchen();

    expect(screen.getByText("Sin sitio")).toBeInTheDocument();
  });
});

describe("using something up", () => {
  it("two separate taps each enqueue exactly one from the selected batch", async () => {
    renderKitchen();
    const button = screen.getByRole("button", { name: /He usado un L/ });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(enqueue).toHaveBeenCalledTimes(2);
    for (const [op] of enqueue.mock.calls) {
      expect(op).toMatchObject({ input: { batchId: "batch-1", quantity: 1 } });
    }
  });

  it("shows one left after two pending uses of a three-unit batch", () => {
    pending = [consumeOp("p1"), { ...consumeOp("p1"), id: "second" }].map((op) => ({
      ...op, input: { ...op.input, batchId: "batch-1" },
    }));
    renderKitchen();
    expect(screen.getByText("Quedan 1 L")).toBeInTheDocument();
  });

  it("does not offer another use after the last unit is queued", () => {
    expiringStub.data = [batch({ quantity: 1 })];
    pending = [{ ...consumeOp("p1"), input: { productId: "p1", batchId: "batch-1", quantity: 1, unit: "L" } }];
    renderKitchen();
    expect(screen.getByRole("button", { name: /He usado un L/ })).toBeDisabled();
  });

  it("leaves ambiguous quantities unconfirmed rather than inventing a remainder", () => {
    expiringStub.data = [batch({ quantity: null })];
    renderKitchen();
    expect(screen.getByText("Cantidad sin confirmar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /He usado un L/ })).toBeDisabled();
  });

  it("enqueues one unit, so it works on a tablet with no signal", async () => {
    renderKitchen();

    await userEvent.click(screen.getByRole("button", { name: /He usado un L/ }));

    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      path: "inventory.consumeStock",
      input: { productId: "p1", batchId: "batch-1", quantity: 1, unit: "L" },
      // §4's ten-second undo window (D100). Without the hold the queue
      // drains in one round-trip online and «Deshacer» flashes for a single
      // render — an undo that exists only without a connection.
      holdMs: 10_000,
    });
  });

  it("names the product in the accessible name, not just on the card", () => {
    renderKitchen();

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
          { id: "p9", name: "Café", totalStock: 0, minStock: 2, onListQuantity: 0, defaultUnit: "ud" },
        ],
      },
      isPending: false,
      error: null,
    };
    renderKitchen();

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(document.querySelector("form")).toBeAbsent();
  });
});

describe("writing it on the list", () => {
  const cafe = {
    id: "p9",
    name: "Café molido",
    totalStock: 0,
    minStock: 2, onListQuantity: 0,
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
    renderKitchen();

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
      // The same undo window as "he usado uno" — see that test.
      holdMs: 10_000,
    });
  });

  it("creates the first list with the first tap, and writes onto it", async () => {
    listsStub = { data: [] };
    renderKitchen();

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

  it("creates one list however quickly the first taps come", async () => {
    // Every tap before the list query caught up saw no list and created one,
    // so a few quick taps left several "Lista de la cocina".
    listsStub = { data: [] };
    createListHeld = true;
    renderKitchen();

    const tap = screen.getByRole("button", { name: /Apuntar «Café molido»/ });
    await userEvent.click(tap);
    await userEvent.click(tap);

    expect(createList).toHaveBeenCalledTimes(1);

    await act(async () => {
      answerCreateList();
    });

    // Both taps land on the one list that was made.
    expect(enqueue).toHaveBeenCalledTimes(2);
    for (const call of enqueue.mock.calls) {
      expect(call[0]).toMatchObject({ input: { shoppingListId: "l-new" } });
    }
  });

  it("says so when the first list cannot be created", async () => {
    listsStub = { data: [] };
    createListFails = true;
    renderKitchen();

    await userEvent.click(
      screen.getByRole("button", { name: /Apuntar «Café molido»/ }),
    );

    expect(enqueue).not.toHaveBeenCalled();
    expect(
      screen.getByText(/no se puede crear la lista/i),
    ).toBeInTheDocument();
  });

  it("offers undo for the add, in the snackbar rather than in the row", async () => {
    renderKitchen();

    await userEvent.click(
      screen.getByRole("button", { name: /Apuntar «Café molido»/ }),
    );

    expect(
      await screen.findAllByText("Añadiste «Café molido» a la lista"),
    ).not.toHaveLength(0);
    // And the row keeps its one action rather than swapping it for an undo:
    // a row whose button changes label under the thumb is a row you mis-tap.
    expect(
      screen.getByRole("button", { name: /Apuntar «Café molido»/ }),
    ).toBeInTheDocument();
  });
});

describe("undo", () => {
  /**
   * The button moved to the snackbar (D101), and the semantics did not. What
   * this file pins is the half the page owns: that a tap offers an undo for
   * *its own* queued change. That the offer is `queue.cancel` and never a
   * compensating write — D57, the invariant — is enforced by the type here
   * (a `undo-queued` entry carries an `opId` and no callback) and asserted
   * against the real component in `Snackbar.test.tsx`.
   */
  it("offers the undo for the change the tap just queued", async () => {
    renderKitchen();

    await userEvent.click(
      screen.getByRole("button", { name: /He usado un L de Leche entera/ }),
    );

    expect(
      await screen.findAllByText("Usaste 1 L de «Leche entera»"),
    ).not.toHaveLength(0);

    // Pressing it cancels the change `enqueue` just returned, and no other —
    // and never writes a compensating one (D57).
    await userEvent.click(
      await screen.findByRole("button", { name: "Deshacer" }),
    );
    expect(cancel).toHaveBeenCalledWith("op-1");
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the queue refused the change for want of room", async () => {
    enqueue.mockImplementationOnce(() => ({ ok: false, reason: "full" }));
    renderKitchen();

    await userEvent.click(
      screen.getByRole("button", { name: /He usado un L de Leche entera/ }),
    );

    // The shell's own banner reports a full queue, which is a state. Telling
    // someone the unit was used when it was not is worse than silence.
    expect(screen.queryByRole("button", { name: "Deshacer" })).toBeAbsent();
    expect(screen.queryAllByText(/Usaste/)).toHaveLength(0);
  });

  it("keeps no undo button in the card, which moved the row under the thumb", () => {
    pending = [consumeOp("p1")];
    renderKitchen();

    // A second button appearing under the one just pressed pushed the next
    // row down — on the tier where taps are least precise.
    expect(screen.queryByRole("button", { name: /Deshacer/ })).toBeAbsent();
  });
});

describe("what the lists already cover", () => {
  const runningOut = (onListQuantity: number, totalStock = 1, minStock = 2) => ({
    data: {
      products: [
        {
          id: "p9",
          name: "Café molido",
          totalStock,
          minStock,
          onListQuantity,
          defaultUnit: "paquete",
        },
      ],
    },
    isPending: false,
    error: null,
  });

  it("does not report good news when it could not ask", () => {
    stockStub = {
      data: undefined,
      isPending: false,
      error: new Error("no"),
      refetch: () => {},
    };
    renderKitchen();

    // `lowStock` fell back to an empty array and an empty array rendered
    // "No falta nada" — so a failed query told a household everything was in
    // stock. On a tablet propped up in a kitchen and read from a metre away
    // that is the worst shape a failure can take: it looks exactly like good
    // news, and nobody goes to check.
    expect(screen.queryByText("No falta nada")).toBeAbsent();
    expect(
      screen.getByText("No se ha podido comprobar qué falta."),
    ).toBeInTheDocument();
  });

  it("says it is still asking rather than answering early", () => {
    stockStub = {
      data: undefined,
      isPending: true,
      error: null,
      refetch: () => {},
    };
    renderKitchen();

    expect(screen.queryByText("No falta nada")).toBeAbsent();
    expect(screen.getByText("Comprobando qué falta…")).toBeInTheDocument();
  });

  it("still says nothing is running out when that is the answer", () => {
    stockStub = { data: { products: [] }, isPending: false, error: null };
    renderKitchen();

    expect(screen.getByText("No falta nada")).toBeInTheDocument();
  });


  it("does not say the same word twice in one row", () => {
    stockStub = runningOut(1);
    renderKitchen();

    // The label is "Queda" and the value used to open with it too, so the row
    // read "Queda / Queda 1 de 2 paquete" — and at zero, "Queda / No queda
    // nada". On a tablet read from a metre away that is a word of the
    // sentence spent twice.
    expect(screen.getByText("1 de 2 paquete")).toBeInTheDocument();
    expect(screen.queryByText(/Queda 1 de 2/)).toBeAbsent();
  });

  it("stops offering to add what is already covered", () => {
    // One left, one already written down, a minimum of two: buying more is
    // not what this product needs, and a button that stays lit on a tablet
    // read from a metre away is a button somebody presses again.
    stockStub = runningOut(1);
    renderKitchen();

    expect(
      screen.queryByRole("button", { name: /Apuntar/ }),
    ).toBeAbsent();
    expect(screen.getByText("Ya en la lista: 1 paquete")).toBeInTheDocument();
  });

  it("keeps offering while the two together are still short", () => {
    // One left, one on the list, a minimum of six. Still short by four.
    stockStub = runningOut(1, 1, 6);
    renderKitchen();

    expect(
      screen.getByRole("button", { name: /Apuntar «Café molido»/ }),
    ).toBeInTheDocument();
  });

  it("counts a tap that has not been sent yet", () => {
    stockStub = runningOut(0);
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
    renderKitchen();

    // The server has not heard yet. Without folding the queue in, the button
    // stays lit offline and the second tap writes a second item.
    expect(screen.queryByRole("button", { name: /Apuntar/ })).toBeAbsent();
  });

  it("says nothing about a product with no minimum, rather than suppressing it", () => {
    // Nothing said what enough means, so nothing can say it is not enough.
    stockStub = runningOut(0, 0, null as unknown as number);
    renderKitchen();

    expect(screen.queryByRole("button", { name: /Apuntar/ })).toBeAbsent();
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
            minStock: 2, onListQuantity: 0,
            defaultUnit: "paquete",
          },
        ],
      },
      isPending: false,
      error: null,
    };
    renderKitchen();

    expect(screen.getByText("1 de 2 paquete")).toBeInTheDocument();
  });

  it("says plainly when there is none", () => {
    stockStub = {
      data: {
        products: [
          {
            id: "p9",
            name: "Café molido",
            totalStock: 0,
            minStock: 2, onListQuantity: 0,
            defaultUnit: "paquete",
          },
        ],
      },
      isPending: false,
      error: null,
    };
    renderKitchen();

    expect(screen.getByText("Nada")).toBeInTheDocument();
  });

  it("counts a queued use against what is left", () => {
    stockStub = {
      data: {
        products: [
          {
            id: "p1",
            name: "Leche entera",
            totalStock: 2,
            minStock: 6, onListQuantity: 0,
            defaultUnit: "L",
          },
        ],
      },
      isPending: false,
      error: null,
    };
    pending = [consumeOp("p1")];
    renderKitchen();

    // Two litres, one used and not yet sent: the tablet must not still say two.
    expect(screen.getByText("1 de 6 L")).toBeInTheDocument();
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
    renderKitchen();

    expect(
      screen.getByText("Aquí todavía no hay nada guardado"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No hay nada a punto de caducar")).toBeAbsent();
  });
});
