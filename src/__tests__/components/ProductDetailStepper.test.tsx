import "../setup/matchers";
import {
  describe,
  it,
  expect,
  afterEach,
  beforeEach,
  mock,
  setSystemTime,
} from "bun:test";
import { createContext } from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import type { QueuedOp, EnqueueResult } from "@/lib/offline/queue";

/**
 * The ± stepper on `/products/[id]` — §3 flow 3, Journey 4: changing stock is
 * a press, not a form.
 *
 * What this file pins: each press is a **delta** through the offline queue
 * (`addStock`/`consumeStock` of one, never a new absolute value — the property
 * Journey 6's history depends on); the number shown is the projection of the
 * server total with unsent presses folded on; the confirmation is the
 * snackbar's sentence with its ten-second undo; and a role the server would
 * refuse reads a number instead of a control (D90's shape).
 */

const enqueue = mock((_op: unknown): EnqueueResult => ({
  ok: true,
  id: "op-1",
}));
const cancel = mock((_id: string) => true);

let pending: QueuedOp[] = [];
let role: "MEMBER" | "KITCHEN" = "MEMBER";
let totalStock = 2;
let minStock: number | null = null;
let stockEntries: Array<Record<string, unknown>> = [];

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/products/p1",
  useParams: () => ({}),
  redirect: () => {},
}));

mock.module("@/lib/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending, failed: [], status: "idle", full: false },
    enqueue,
    cancel,
    holdRemainingMs: () => 10_000,
    drain: () => {},
    retry: () => {},
    discard: () => {},
    flush: async () => {},
    purgeAll: () => {},
  }),
}));

const product = () => ({
  id: "p1",
  name: "Aceite de oliva",
  brand: null,
  category: null,
  barcode: null,
  imageUrl: null,
  defaultUnit: "L",
  minStock,
  totalStock,
  openFoodFactsData: null,
  createdAt: new Date("2026-08-01T10:00:00Z"),
  stockEntries,
  priceRecords: [],
});

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
        useMutation: () => ({ mutate: () => {}, isPending: false }),
      },
      update: {
        useMutation: () => ({ mutate: () => {}, isPending: false }),
      },
    },
  },
}));

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const { ProductDetailView } =
  await import("@/app/(dashboard)/products/[id]/page");

const renderDetail = () =>
  renderWithIntl(
    <SnackbarProvider>
      <ProductDetailView id="p1" />
    </SnackbarProvider>,
  );

/** An incoming entry at the fridge, so the product has a usual location. */
function fridgeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "se-1",
    quantity: 2,
    unit: "L",
    locationId: "loc-fridge",
    location: { id: "loc-fridge", name: "Nevera" },
    expirationDate: null,
    createdAt: new Date("2026-08-10T10:00:00Z"),
    ...overrides,
  };
}

function consumeOp(): QueuedOp {
  return {
    id: "op-pending",
    path: "inventory.consumeStock",
    input: { productId: "p1", quantity: 1, unit: "L" },
    householdId: "h1",
    label: { key: "offline.usedUp" },
    createdAt: new Date("2026-08-20T10:00:00Z"),
    attempts: 0,
  };
}

beforeEach(() => {
  enqueue.mockClear();
  cancel.mockClear();
  pending = [];
  role = "MEMBER";
  totalStock = 2;
  minStock = null;
  stockEntries = [fridgeEntry()];
});

afterEach(cleanup);

describe("each press is a delta, not a new total", () => {
  it("books one without inventing a location or expiry", async () => {
    renderDetail();

    await userEvent.click(
      screen.getByRole("button", { name: "Añadir 1 L de «Aceite de oliva»" }),
    );

    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      path: "inventory.addStock",
      input: { productId: "p1", quantity: 1, unit: "L" },
      holdMs: 10_000,
    });
    const op = enqueue.mock.calls[0]?.[0] as { input: object };
    expect(op.input).not.toHaveProperty("locationId");
    expect(op.input).not.toHaveProperty("expirationDate");
  });

  it("books a consumption of one, with no location", async () => {
    renderDetail();

    await userEvent.click(
      screen.getByRole("button", { name: "Usar 1 L de «Aceite de oliva»" }),
    );

    const op = enqueue.mock.calls[0]?.[0] as {
      input?: Record<string, unknown>;
    };
    expect(op).toMatchObject({
      path: "inventory.consumeStock",
      input: { productId: "p1", quantity: 1, unit: "L" },
      holdMs: 10_000,
    });
    expect(op.input).not.toHaveProperty("locationId");
  });

  it("presses twice, two deltas of one — never one write of the sum", async () => {
    renderDetail();

    const plus = screen.getByRole("button", {
      name: "Añadir 1 L de «Aceite de oliva»",
    });
    await userEvent.click(plus);
    await userEvent.click(plus);

    expect(enqueue).toHaveBeenCalledTimes(2);
    for (const call of enqueue.mock.calls) {
      expect(call[0]).toMatchObject({
        path: "inventory.addStock",
        input: { quantity: 1 },
      });
    }
  });
});

describe("the number shown is the projection", () => {
  it("folds an unsent consumption onto the server's total", () => {
    pending = [consumeOp()];
    renderDetail();

    // Two litres on the server, one press not yet sent: the screen must not
    // still say two. The stepper's number is its own text node; the unit is
    // the sibling span.
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("2")).toBeAbsent();
  });

  it("takes the below-minimum sentence away when unsent presses clear it", () => {
    totalStock = 1;
    minStock = 2;
    pending = [
      {
        ...consumeOp(),
        id: "op-add",
        path: "inventory.addStock",
        input: { productId: "p1", quantity: 1, unit: "L" },
        label: { key: "offline.addedStock" },
      },
    ];
    renderDetail();

    expect(screen.queryByText(/Por debajo del mínimo/)).toBeAbsent();
  });

  it("disables minus at a projected zero and says there is nothing left", () => {
    totalStock = 1;
    pending = [consumeOp()];
    renderDetail();

    expect(
      screen.getByRole("button", { name: "Usar 1 L de «Aceite de oliva»" }),
    ).toBeDisabled();
    expect(
      screen.getByText("No queda nada de este producto."),
    ).toBeInTheDocument();
  });
});

describe("confirmed in plain words, with undo", () => {
  it("says what the press did and offers to take it back", async () => {
    renderDetail();

    await userEvent.click(
      screen.getByRole("button", { name: "Añadir 1 L de «Aceite de oliva»" }),
    );

    expect(
      await screen.findAllByText("Añadiste 1 L de «Aceite de oliva»"),
    ).not.toHaveLength(0);

    // Undo cancels the queued change — never a compensating write (D57).
    await userEvent.click(
      await screen.findByRole("button", { name: "Deshacer" }),
    );
    expect(cancel).toHaveBeenCalledWith("op-1");
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the queue refused the change for want of room", async () => {
    enqueue.mockImplementationOnce(() => ({ ok: false, reason: "full" }));
    renderDetail();

    await userEvent.click(
      screen.getByRole("button", { name: "Añadir 1 L de «Aceite de oliva»" }),
    );

    expect(screen.queryByRole("button", { name: "Deshacer" })).toBeAbsent();
    expect(screen.queryAllByText(/Añadiste/)).toHaveLength(0);
  });
});

describe("who gets the control", () => {
  it("shows a kitchen account the number, not the stepper", () => {
    role = "KITCHEN";
    renderDetail();

    // Plus is `addStock`, which `writeProcedure` refuses a KITCHEN account.
    // Hiding is courtesy; the middleware is the control (D90).
    expect(screen.queryByRole("button", { name: /Añadir 1 L/ })).toBeAbsent();
    expect(screen.queryByRole("button", { name: /Usar 1 L/ })).toBeAbsent();
    // The plain total is a paragraph; the "2 L" in the locations list is a span.
    expect(screen.getByText("2 L", { selector: "p" })).toBeInTheDocument();
  });
});

/**
 * The batch list's expiry status is a calendar question. The picker's date is
 * stored as UTC midnight, and comparing that instant with `Date.now()` called
 * a carton expired from 02:00 on the day printed on it, in Madrid.
 */
describe("a batch's expiry is read as a date", () => {
  afterEach(() => {
    setSystemTime();
  });

  it("is not expired on the day it is dated, and is the day after", () => {
    // 11:00 in Madrid on the 6th.
    setSystemTime(new Date("2026-10-06T09:00:00Z"));
    stockEntries = [
      fridgeEntry({ id: "today", expirationDate: new Date("2026-10-06") }),
      fridgeEntry({ id: "yesterday", expirationDate: new Date("2026-10-05") }),
    ];
    renderDetail();

    // `ExpiryStatus`'s words: the batch dated today goes off today, the one
    // dated yesterday went off yesterday — not "expired" from 02:00 today.
    expect(screen.getByText("Caduca hoy").closest("li")?.textContent).toContain(
      "6",
    );
    const expired = screen.getByText("Caducó ayer").closest("li");
    expect(expired?.textContent).toContain("5");
  });

  it("names the day that was stored, west of UTC too", () => {
    // Stored as UTC midnight of the 6th; in New York that instant is the
    // evening of the 5th, and the batch list said "05 de octubre".
    const previous = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      setSystemTime(new Date("2026-10-01T15:00:00Z"));
      // The premise, checked rather than assumed: if the runtime did not
      // take the zone, this test would pass for the wrong reason.
      expect(new Date("2026-10-06T00:00:00Z").getDate()).toBe(5);
      stockEntries = [
        fridgeEntry({ id: "dated", expirationDate: new Date("2026-10-06") }),
      ];
      renderDetail();

      expect(screen.getByText(/6 de octubre de 2026/)).toBeInTheDocument();
      expect(screen.queryByText(/5 de octubre de 2026/)).toBeAbsent();
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
