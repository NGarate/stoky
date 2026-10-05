import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";

const enqueue = mock((_op: unknown) => ({ ok: true as const, id: "op-1" }));
const cancel = mock((_id: string) => true);

mock.module("@/lib/offline/queue-context", () => ({
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
    // The row reports through the snackbar now, and the snackbar asks the
    // queue how long a change can still be taken back.
    cancel,
    holdRemainingMs: () => 10_000,
  }),
}));

const { ShoppingItem } = await import("@/components/shopping/ShoppingItem");
const { SnackbarProvider } = await import("@/components/ui/snackbar");

/**
 * The real provider, never a stub of it.
 *
 * `mock.module` replaces a module for the whole process, so stubbing the
 * snackbar here would poison `Snackbar.test.tsx` depending on which suite bun
 * loaded first. Mounting the real one costs nothing and is what the screen
 * does.
 */
function render(
  ui: React.ReactElement,
  options?: Parameters<typeof renderWithIntl>[1],
): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(<SnackbarProvider>{ui}</SnackbarProvider>, options);
}

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
  cancel.mockClear();
});

afterEach(cleanup);


/** The queued change this component asked for. */
function lastEnqueued(): Record<string, unknown> {
  return enqueue.mock.calls[0]?.[0] as Record<string, unknown>;
}

/**
 * A row added with no signal, still in the queue.
 *
 * Its `id` is the queued addition's, not a row the server has. Every control
 * on the row wrote against that id: the tick and the quantity were refused as
 * a row that does not exist, and the bin queued a removal that was refused
 * while the addition ahead of it drained and put the item on the list anyway.
 */
describe("an addition that has not been sent", () => {
  const queuedItem = { ...baseItem, id: "op-add", queued: true };

  it("is taken back by cancelling the addition, not by removing a row", async () => {
    render(<ShoppingItem canWrite stores={STORES} item={queuedItem} />);

    await userEvent.click(screen.getByRole("button", { name: "Eliminar artículo" }));

    expect(cancel).toHaveBeenCalledWith("op-add");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("offers no tick until there is something on the server to tick", () => {
    render(<ShoppingItem canWrite stores={STORES} item={queuedItem} />);

    expect(screen.queryByRole("checkbox")).toBeAbsent();
    expect(screen.getByText("Sin enviar todavía")).toBeInTheDocument();
  });

  it("offers no quantity or shop to change yet", () => {
    render(<ShoppingItem canWrite stores={STORES} item={queuedItem} />);

    expect(screen.queryByRole("spinbutton")).toBeAbsent();
    expect(screen.queryByRole("combobox")).toBeAbsent();
  });
});

describe("ShoppingItem", () => {
  it("shows the linked product name and quantity", () => {
    render(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

    expect(screen.getByText("Leche entera")).toBeInTheDocument();
    // The quantity is an editable field now, not a sentence.
    expect(screen.getByLabelText(/Cantidad de «Leche entera»/)).toHaveValue(2);
    expect(screen.getByText("L")).toBeInTheDocument();
  });

  it("falls back to the custom name for free-text items", () => {
    render(
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
    render(
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
    render(
      <ShoppingItem canWrite stores={STORES} item={{ ...baseItem, isChecked: true }} />,
    );

    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("strikes through the name once checked", () => {
    render(
      <ShoppingItem canWrite stores={STORES} item={{ ...baseItem, isChecked: true }} />,
    );

    expect(screen.getByText("Leche entera")).toHaveClass("line-through");
  });

  it("toggles an unchecked item to checked", async () => {
    render(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

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
    render(
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
    render(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

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

  it("holds the removal, and offers to take it back", async () => {
    render(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Eliminar artículo" }),
    );

    // This screen is not Screen A: it has no trolley to hold a removal, so
    // the bin used to be one tap, silent and final. §7's "undo instead of
    // confirm" only works where an undo exists, and the hold is what makes
    // one exist — cancelling the queued change, never a compensating write
    // (D57).
    expect(lastEnqueued()).toMatchObject({ holdMs: 10_000 });
    expect(
      await screen.findByRole("button", { name: "Deshacer" }),
    ).toBeInTheDocument();
  });

  it("puts back a quantity it would not accept", async () => {
    render(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

    const box = screen.getByLabelText("Cantidad de «Leche entera»");
    fireEvent.change(box, { target: { value: "0" } });
    fireEvent.blur(box);

    // The box is uncontrolled — `defaultValue` keyed on the quantity — so a
    // rejected value simply stayed there: the row read "0 L" while the list
    // still said two, and nothing corrected it until the quantity changed by
    // some other route.
    expect((box as HTMLInputElement).value).toBe("2");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("says a quantity change happened, which is easy to miss on blur", async () => {
    render(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

    const box = screen.getByLabelText("Cantidad de «Leche entera»");
    fireEvent.change(box, { target: { value: "5" } });
    fireEvent.blur(box);

    expect(await screen.findAllByText("Cambiaste «Leche entera»")).not.toHaveLength(0);
  });

  it("says the shop changed too", async () => {
    render(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

    fireEvent.change(screen.getByLabelText("Dónde comprar «Leche entera»"), {
      target: { value: "s1" },
    });

    expect(await screen.findAllByText("Cambiaste «Leche entera»")).not.toHaveLength(0);
  });

  it("offers a reader none of the controls the server refuses them", () => {
    render(<ShoppingItem canWrite={false} stores={STORES} item={baseItem} />);

    // `canWrite` reached the quantity and the shop and stopped there, so a
    // KITCHEN account was still offered the tick and the bin — two controls
    // `writeProcedure` refuses, found out by pressing one. D88 widened that
    // role by exactly two capabilities and neither is this.
    expect(screen.queryByRole("checkbox")).toBeAbsent();
    expect(screen.queryByRole("button", { name: "Eliminar artículo" })).toBeAbsent();
  });

  it("still tells a reader whether it has been bought", () => {
    render(
      <ShoppingItem
        canWrite={false}
        stores={STORES}
        item={{ ...baseItem, isChecked: true }}
      />,
    );

    // Removing the control must not remove the fact.
    expect(screen.getByText("Comprado")).toBeInTheDocument();
  });

  it("still shows a reader where to buy it", () => {
    render(<ShoppingItem canWrite={false} stores={STORES} item={baseItem} />);

    // Prices are a read, so the one action that survives is the link to them.
    expect(
      screen.getByRole("link", { name: /Ver precios/ }),
    ).toBeInTheDocument();
  });

  it("says nothing when the row is ticked off, and that is deliberate", async () => {
    render(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

    await userEvent.click(screen.getByRole("checkbox"));

    // The one write on this row that reports nothing. Its result is not
    // transient — the row strikes through, gains a badge and stays that way,
    // and the control that did it undoes it. Someone working down a list in
    // a shop ticks continuously, and a stack of confirmations over the bottom
    // of the screen would cover the list they are reading.
    expect(screen.queryByTestId("snackbar")).toBeAbsent();
  });

  it("never blocks the next tap on the last one", async () => {
    // This replaces "disables the delete control while the removal is in
    // flight". There is no flight any more: enqueueing is synchronous, which
    // is the point — someone walking down an aisle should not wait on a
    // round trip between two items.
    render(<ShoppingItem canWrite stores={STORES} item={baseItem} />);

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
    render(<ShoppingItem canWrite stores={STORES} item={baseItem} />);
    await userEvent.click(screen.getByRole("checkbox"));

    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("changes the quantity through the queue, like every other write here", async () => {
    render(
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
      input: { id: "item-1", quantity: 6, quantityUnit: "L" },
    });
  });

  it("says nothing when the quantity has not actually changed", () => {
    render(
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
    render(
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
    render(
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
    render(
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
    expect(screen.queryByRole("spinbutton")).toBeAbsent();
    expect(screen.queryByRole("combobox")).toBeAbsent();
    expect(screen.getByText("2 L")).toBeInTheDocument();
    expect(screen.getByText("Mercadona")).toBeInTheDocument();
  });

  it("offers what it costs where, from the aisle", () => {
    render(
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
    render(
      <ShoppingItem
        canWrite
        item={{ ...baseItem, productId: null, product: null }}
        stores={STORES}
      />,
    );

    expect(screen.queryByRole("link")).toBeAbsent();
  });
});
