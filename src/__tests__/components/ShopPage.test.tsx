import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { createContext } from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import type { QueuedOp } from "@/lib/offline/queue";

/**
 * Screen A, the phone's first screen (`REDESIGN_PLAN.md` §3).
 *
 * The rules it is built to are §7's, and each one below is a test rather than
 * a comment: one primary action, state in words rather than colour, undo
 * instead of confirm, and every write through the queue so none of it needs a
 * signal.
 */

const enqueue = mock((_op: unknown) => ({ ok: true as const, id: "op-1" }));

let queryStub: {
  data: unknown;
  isPending: boolean;
  error: unknown;
  fetchStatus: "fetching" | "paused" | "idle";
  refetch: () => void;
};
let pending: QueuedOp[] = [];

mock.module("@/components/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending, failed: [], status: "idle", full: false },
    enqueue,
    drain: () => {},
    retry: () => {},
    discard: () => {},
    flush: async () => {},
    purgeAll: () => {},
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ invalidate: () => Promise.resolve() }),
    household: { create: { useMutation: () => ({ mutate: () => {}, isPending: false }) } },
    shopping: { getBuyList: { useQuery: () => queryStub } },
  },
}));

const { default: ShopPage } = await import("@/app/(dashboard)/shopping/page");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    name: "Leche entera",
    quantity: 1,
    unit: "L",
    isChecked: false,
    productId: "p1",
    listId: "list-1",
    listName: "Compra semanal",
    stock: 2,
    minStock: 6,
    ...overrides,
  };
}

beforeEach(() => {
  enqueue.mockClear();
  pending = [];
  queryStub = {
    data: [row()],
    isPending: false,
    error: null,
    fetchStatus: "idle",
    refetch: () => {},
  };
});

afterEach(cleanup);

describe("one task per screen", () => {
  it("puts scanning on top as the only primary action", () => {
    renderWithIntl(<ShopPage />);

    const scan = screen.getByRole("link", { name: "Escanear" });
    expect(scan).toHaveAttribute("href", "/products/scan");
  });

  it("keeps managing lists as a link, not a second primary action", () => {
    renderWithIntl(<ShopPage />);

    // §7 rule 1: two primary actions means two screens. Filing lists moved to
    // /shopping/lists precisely so this screen has one job.
    expect(
      screen.getAllByRole("link", { name: "Ver mis listas" })[0],
    ).toHaveAttribute("href", "/shopping/lists");
  });
});

describe("state in words, never colour alone", () => {
  it("says how much is at home, in a sentence", () => {
    renderWithIntl(<ShopPage />);

    expect(screen.getByText("En casa: 2 de 6 L")).toBeInTheDocument();
  });

  it("says so plainly when there is none left", () => {
    queryStub.data = [row({ stock: 0 })];
    renderWithIntl(<ShopPage />);

    // "No queda nada en casa", not "stock 0" (§7 rule 2).
    expect(screen.getByText("No queda nada en casa")).toBeInTheDocument();
  });

  it("says when there is no minimum rather than drawing an empty bar", () => {
    queryStub.data = [row({ stock: 3, minStock: null })];
    renderWithIntl(<ShopPage />);

    expect(screen.getByText("Sin mínimo fijado")).toBeInTheDocument();
  });

  it("hides the bar from assistive technology, because it adds nothing", () => {
    renderWithIntl(<ShopPage />);

    const row0 = screen.getByRole("button", { name: /Leche entera/ });
    const bars = row0.querySelectorAll('[aria-hidden="true"]');
    expect(bars.length).toBeGreaterThan(0);
  });
});

describe("ticking something off", () => {
  it("enqueues rather than mutating, so it works with no signal", async () => {
    renderWithIntl(<ShopPage />);

    await userEvent.click(screen.getByRole("button", { name: /Leche entera/ }));

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      path: "shopping.updateItem",
      input: { id: "item-1", isChecked: true },
    });
  });

  it("asks for no confirmation", async () => {
    renderWithIntl(<ShopPage />);

    await userEvent.click(screen.getByRole("button", { name: /Leche entera/ }));

    // §7 rule 3. A dialogue here would be asked once per aisle.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says what the tap will do, not just what the row is", () => {
    renderWithIntl(<ShopPage />);

    expect(
      screen.getByRole("button", { name: /Marcar «Leche entera» como comprado/ }),
    ).toBeInTheDocument();
  });

  it("reports the ticked state as a state, not as a style", async () => {
    queryStub.data = [row({ isChecked: true })];
    renderWithIntl(<ShopPage />);

    // A ticked item lives in the trolley, which is folded away.
    await userEvent.click(screen.getByRole("button", { name: /En el carro/ }));

    expect(
      screen.getByRole("button", { name: /Leche entera/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("undo instead of confirm", () => {
  it("lets a ticked item be put back from the trolley", async () => {
    queryStub.data = [row({ isChecked: true })];
    renderWithIntl(<ShopPage />);

    await userEvent.click(screen.getByRole("button", { name: /En el carro/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Devolver «Leche entera»/ }),
    );

    // Not a ten-second toast: an undo that expires is one you miss while
    // reaching for the next shelf. The trolley is still there at the till.
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      input: { id: "item-1", isChecked: false },
    });
  });

  it("folds the trolley away until it is asked for", () => {
    queryStub.data = [row({ isChecked: true })];
    renderWithIntl(<ShopPage />);

    const toggle = screen.getByRole("button", { name: /En el carro/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Devolver/ })).toBeNull();
  });

  it("counts what is in it without being opened", () => {
    queryStub.data = [row({ isChecked: true }), row({ id: "i2", isChecked: true })];
    renderWithIntl(<ShopPage />);

    expect(screen.getByText("2 cosas marcadas")).toBeInTheDocument();
  });
});

describe("what a queued change looks like", () => {
  it("shows a tick that has not been sent yet as done", () => {
    pending = [
      {
        id: "op-1",
        path: "shopping.updateItem",
        input: { id: "item-1", isChecked: true },
        householdId: "h1",
        label: { key: "offline.tickedOff" },
        createdAt: new Date("2026-08-11T10:00:00.000Z"),
        attempts: 0,
      },
    ];
    renderWithIntl(<ShopPage />);

    // Straight into the trolley, before any server has heard about it.
    expect(screen.getByText("1 cosa marcada")).toBeInTheDocument();
  });
});

describe("an empty list", () => {
  it("is an invitation rather than a blank screen", () => {
    queryStub.data = [];
    renderWithIntl(<ShopPage />);

    // §7 rule 5.
    expect(screen.getByText("No hay nada apuntado")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Ver mis listas" }).length,
    ).toBeGreaterThan(0);
  });
});

describe("with no connection and nothing saved", () => {
  it("says so rather than claiming the list is empty", () => {
    queryStub = {
      data: undefined,
      isPending: true,
      error: null,
      fetchStatus: "paused",
      refetch: () => {},
    };
    renderWithIntl(<ShopPage />);

    expect(
      screen.getByText("Aquí todavía no hay nada guardado"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No hay nada apuntado")).toBeNull();
  });
});
