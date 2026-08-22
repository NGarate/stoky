import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup, fireEvent } from "@testing-library/react";
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

const STORES = [{ id: "s1", name: "Mercadona" }];

const baseItem = {
  id: "item-1",
  productId: "product-1",
  product: { name: "Leche entera" },
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
    renderWithIntl(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

    expect(screen.getByText("Leche entera")).toBeInTheDocument();
    // The quantity is an editable field now, not a sentence.
    expect(screen.getByLabelText(/Cantidad de «Leche entera»/)).toHaveValue(2);
    expect(screen.getByText("L")).toBeInTheDocument();
  });

  it("falls back to the custom name for free-text items", () => {
    renderWithIntl(
      <ShoppingItem
        canWrite
        stores={STORES}
        item={{
          ...baseItem,
          productId: "p9",
          product: { name: "Bombillas LED" },
        }}
      />,
    );

    // Free text stopped being a thing an item can be: a product it is, and
    // the product's name is what a row says.
    expect(screen.getByText("Bombillas LED")).toBeInTheDocument();
  });

  it("falls back to the translated placeholder if the product is gone", () => {
    renderWithIntl(
      <ShoppingItem
        canWrite
        stores={STORES}
        item={{ ...baseItem, productId: null, product: null }}
      />,
    );

    // shopping.itemName in messages/es.json
    expect(screen.getByText("Nombre del artículo")).toBeInTheDocument();
  });

  it("reflects the checked state in the checkbox", () => {
    renderWithIntl(
      <ShoppingItem canWrite stores={STORES} item={{ ...baseItem, isChecked: true }} />,
    );

    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("strikes through the name once checked", () => {
    renderWithIntl(
      <ShoppingItem canWrite stores={STORES} item={{ ...baseItem, isChecked: true }} />,
    );

    expect(screen.getByText("Leche entera")).toHaveClass("line-through");
  });

  it("toggles an unchecked item to checked", async () => {
    renderWithIntl(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

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
      <ShoppingItem canWrite stores={STORES} item={{ ...baseItem, isChecked: true }} />,
    );

    await userEvent.click(screen.getByRole("checkbox"));

    expect(lastEnqueued()).toMatchObject({
      path: "shopping.updateItem",
      input: { id: "item-1", isChecked: false },
      label: { key: "offline.untickedOff" },
    });
  });

  it("removes the item via the labelled delete control", async () => {
    renderWithIntl(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

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
    renderWithIntl(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

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
    renderWithIntl(<ShoppingItem canWrite stores={STORES} item={baseItem} />);
    await userEvent.click(screen.getByRole("checkbox"));

    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("changes the quantity through the queue, like every other write here", async () => {
    renderWithIntl(
      <ShoppingItem
        canWrite
        item={{ ...baseItem, product: { name: "Leche entera" } }}
        stores={STORES}
      />,
    );

    const field = screen.getByLabelText(/Cantidad de «Leche entera»/);
    fireEvent.change(field, { target: { value: "6" } });
    fireEvent.blur(field);

    // Not a mutation: a change made in a supermarket basement has to survive
    // having no signal, exactly as the tick does.
    expect(enqueue.mock.calls).toHaveLength(1);
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      path: "shopping.updateItem",
      input: { id: "item-1", quantity: 6 },
    });
  });

  it("says nothing when the quantity has not actually changed", () => {
    renderWithIntl(
      <ShoppingItem
        canWrite
        item={{ ...baseItem, product: { name: "Leche entera" } }}
        stores={STORES}
      />,
    );

    // Blurring a field you only looked at is not an edit, and a queued write
    // per glance is a queue full of nothing.
    fireEvent.blur(screen.getByLabelText(/Cantidad de «Leche entera»/));

    expect(enqueue.mock.calls).toHaveLength(0);
  });

  it("refuses a quantity of zero rather than queueing it", () => {
    renderWithIntl(
      <ShoppingItem
        canWrite
        item={{ ...baseItem, product: { name: "Leche entera" } }}
        stores={STORES}
      />,
    );

    const field = screen.getByLabelText(/Cantidad de «Leche entera»/);
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.blur(field);

    expect(enqueue.mock.calls).toHaveLength(0);
  });

  it("chooses where to buy it, and lets that be nowhere in particular", () => {
    renderWithIntl(
      <ShoppingItem
        canWrite
        item={{ ...baseItem, product: { name: "Leche entera" }, storeId: "s1" }}
        stores={STORES}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Dónde comprar «Leche entera»/), {
      target: { value: "" },
    });

    // Null, not an empty string: "anywhere" is a real answer and the column
    // is nullable for it.
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      path: "shopping.updateItem",
      input: { id: "item-1", storeId: null },
    });
  });

  it("shows a kitchen account the values without the controls", () => {
    renderWithIntl(
      <ShoppingItem
        canWrite={false}
        item={{
          ...baseItem,
          product: { name: "Leche entera" },
          store: { id: "s1", name: "Mercadona" },
          storeId: "s1",
        }}
        stores={STORES}
      />,
    );

    // D88 widened KITCHEN by exactly two capabilities and editing an item is
    // not one of them. `writeProcedure` is the control; this is courtesy, so
    // the values are still readable.
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("2 L")).toBeInTheDocument();
    expect(screen.getByText("Mercadona")).toBeInTheDocument();
  });

  it("offers what it costs where, from the aisle", () => {
    renderWithIntl(
      <ShoppingItem
        canWrite
        item={{ ...baseItem, product: { name: "Leche entera" } }}
        stores={STORES}
      />,
    );

    // What makes choosing a shop above an informed decision rather than a
    // guess: the answer is one tap away, where the question is asked.
    const link = screen.getByRole("link", { name: /Ver precios de «Leche entera»/ });
    expect(link.getAttribute("href")).toBe("/prices/product-1");
  });

  it("offers no price link when there is no product to price", () => {
    renderWithIntl(
      <ShoppingItem
        canWrite
        item={{ ...baseItem, productId: null, product: null }}
        stores={STORES}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
  });
});
