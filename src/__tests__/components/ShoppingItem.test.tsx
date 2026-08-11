import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";

const enqueue = mock((_op: unknown) => ({ ok: true as const, id: "op-1" }));

mock.module("@/components/offline/queue-context", () => ({
  // A real context as well as the hook. `mock.module` replaces the module for
  // the whole process, and `WriteQueueProvider` renders
  // `WriteQueueContext.Provider` — so a mock that omits it turns the provider
  // into a syntax error in whichever suite renders the real one.
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending: [], failed: [], status: "idle", full: false },
    enqueue,
    drain: () => {},
    retry: () => {},
    discard: () => {},
  }),
}));

const { ShoppingItem } = await import("@/components/shopping/ShoppingItem");

const baseItem = {
  id: "item-1",
  productId: "product-1",
  product: { name: "Leche entera" },
  customName: null,
  quantity: 2,
  unit: "L",
  isChecked: false,
};

beforeEach(() => {
  enqueue.mockClear();
});

afterEach(cleanup);


/** The queued change this component asked for. */
function lastEnqueued(): Record<string, unknown> {
  return enqueue.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("ShoppingItem", () => {
  it("shows the linked product name and quantity", () => {
    renderWithIntl(<ShoppingItem item={baseItem} />);

    expect(screen.getByText("Leche entera")).toBeInTheDocument();
    expect(screen.getByText("2 L")).toBeInTheDocument();
  });

  it("falls back to the custom name for free-text items", () => {
    renderWithIntl(
      <ShoppingItem
        item={{
          ...baseItem,
          productId: null,
          product: null,
          customName: "Bombillas",
        }}
      />,
    );

    expect(screen.getByText("Bombillas")).toBeInTheDocument();
  });

  it("falls back to the translated placeholder when the item has no name", () => {
    renderWithIntl(
      <ShoppingItem
        item={{ ...baseItem, productId: null, product: null, customName: null }}
      />,
    );

    // shopping.itemName in messages/es.json
    expect(screen.getByText("Nombre del artículo")).toBeInTheDocument();
  });

  it("reflects the checked state in the checkbox", () => {
    renderWithIntl(
      <ShoppingItem item={{ ...baseItem, isChecked: true }} />,
    );

    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("strikes through the name once checked", () => {
    renderWithIntl(
      <ShoppingItem item={{ ...baseItem, isChecked: true }} />,
    );

    expect(screen.getByText("Leche entera")).toHaveClass("line-through");
  });

  it("toggles an unchecked item to checked", async () => {
    renderWithIntl(<ShoppingItem item={baseItem} />);

    await userEvent.click(screen.getByRole("checkbox"));

    // Enqueued, not mutated. With no signal a mutation fails and the tap is
    // lost; the queue is the whole point of ticking a list off in a basement.
    expect(lastEnqueued()).toMatchObject({
      path: "shopping.updateItem",
      input: { id: "item-1", isChecked: true },
      label: { key: "offline.tickedOff", values: { name: "Leche entera" } },
    });
  });

  it("toggles a checked item back to unchecked", async () => {
    renderWithIntl(
      <ShoppingItem item={{ ...baseItem, isChecked: true }} />,
    );

    await userEvent.click(screen.getByRole("checkbox"));

    expect(lastEnqueued()).toMatchObject({
      path: "shopping.updateItem",
      input: { id: "item-1", isChecked: false },
      label: { key: "offline.untickedOff" },
    });
  });

  it("removes the item via the labelled delete control", async () => {
    renderWithIntl(<ShoppingItem item={baseItem} />);

    // shopping.removeItem in messages/es.json
    await userEvent.click(
      screen.getByRole("button", { name: "Eliminar artículo" }),
    );

    expect(lastEnqueued()).toMatchObject({
      path: "shopping.removeItem",
      input: { id: "item-1" },
      label: { key: "offline.removedItem", values: { name: "Leche entera" } },
    });
  });

  it("never blocks the next tap on the last one", async () => {
    // This replaces "disables the delete control while the removal is in
    // flight". There is no flight any more: enqueueing is synchronous, which
    // is the point — someone walking down an aisle should not wait on a
    // round trip between two items.
    renderWithIntl(<ShoppingItem item={baseItem} />);

    const remove = screen.getByRole("button", { name: "Eliminar artículo" });
    expect(remove).not.toBeDisabled();

    await userEvent.click(remove);

    expect(remove).not.toBeDisabled();
  });

  it("does not reach for the tRPC client at all", async () => {
    // This replaces "invalidates the list caches after a successful toggle".
    // Refreshing the cache is now the drain's job, once per settled drain
    // rather than once per tap — asserted in WriteQueueProvider.test.tsx. What
    // is left to check here is that this component has no second path to the
    // server, because two paths is two things to get wrong.
    renderWithIntl(<ShoppingItem item={baseItem} />);
    await userEvent.click(screen.getByRole("checkbox"));

    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
