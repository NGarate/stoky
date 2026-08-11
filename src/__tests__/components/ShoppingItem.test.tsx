import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl, TEST_COMPOSER } from "../utils/render";

const updateItemMutate = mock((_input: unknown) => {});
const removeItemMutate = mock((_input: unknown) => {});
const getByIdInvalidate = mock((_input: unknown) => {});
const listInvalidate = mock(() => {});

let removeItemPending = false;

// Captured so a test can drive the onSuccess callback the component registers.
let updateItemOptions: { onSuccess?: () => void } = {};

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      shopping: {
        getById: { invalidate: getByIdInvalidate },
        list: { invalidate: listInvalidate },
      },
    }),
    shopping: {
      updateItem: {
        useMutation: (options: { onSuccess?: () => void } = {}) => {
          updateItemOptions = options;
          return { mutate: updateItemMutate, isPending: false };
        },
      },
      removeItem: {
        useMutation: () => ({
          mutate: removeItemMutate,
          isPending: removeItemPending,
        }),
      },
    },
  },
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
  updateItemMutate.mockClear();
  removeItemMutate.mockClear();
  getByIdInvalidate.mockClear();
  listInvalidate.mockClear();
  removeItemPending = false;
  updateItemOptions = {};
});

afterEach(cleanup);


/**
 * Every write this component makes is one a queue may replay, so each carries a
 * fresh key and the account that composed it. Asserted rather than ignored: a
 * mutate that reached the server without them would be refused by Zod, and a
 * shared key would make two taps into one change.
 */
function expectEnvelope(call: Record<string, unknown>): void {
  expect(call.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(call.composedByUserId).toBe(TEST_COMPOSER.userId);
}

describe("ShoppingItem", () => {
  it("shows the linked product name and quantity", () => {
    renderWithIntl(<ShoppingItem item={baseItem} listId="list-1" />);

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
        listId="list-1"
      />,
    );

    expect(screen.getByText("Bombillas")).toBeInTheDocument();
  });

  it("falls back to the translated placeholder when the item has no name", () => {
    renderWithIntl(
      <ShoppingItem
        item={{ ...baseItem, productId: null, product: null, customName: null }}
        listId="list-1"
      />,
    );

    // shopping.itemName in messages/es.json
    expect(screen.getByText("Nombre del artículo")).toBeInTheDocument();
  });

  it("reflects the checked state in the checkbox", () => {
    renderWithIntl(
      <ShoppingItem item={{ ...baseItem, isChecked: true }} listId="list-1" />,
    );

    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("strikes through the name once checked", () => {
    renderWithIntl(
      <ShoppingItem item={{ ...baseItem, isChecked: true }} listId="list-1" />,
    );

    expect(screen.getByText("Leche entera")).toHaveClass("line-through");
  });

  it("toggles an unchecked item to checked", async () => {
    renderWithIntl(<ShoppingItem item={baseItem} listId="list-1" />);

    await userEvent.click(screen.getByRole("checkbox"));

    const call = updateItemMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({ id: "item-1", isChecked: true });
    expectEnvelope(call);
  });

  it("toggles a checked item back to unchecked", async () => {
    renderWithIntl(
      <ShoppingItem item={{ ...baseItem, isChecked: true }} listId="list-1" />,
    );

    await userEvent.click(screen.getByRole("checkbox"));

    const call = updateItemMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({ id: "item-1", isChecked: false });
    expectEnvelope(call);
  });

  it("removes the item via the labelled delete control", async () => {
    renderWithIntl(<ShoppingItem item={baseItem} listId="list-1" />);

    // shopping.removeItem in messages/es.json
    await userEvent.click(
      screen.getByRole("button", { name: "Eliminar artículo" }),
    );

    const call = removeItemMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({ id: "item-1" });
    expectEnvelope(call);
  });

  it("disables the delete control while the removal is in flight", () => {
    removeItemPending = true;
    renderWithIntl(<ShoppingItem item={baseItem} listId="list-1" />);

    expect(
      screen.getByRole("button", { name: "Eliminar artículo" }),
    ).toBeDisabled();
  });

  it("invalidates the list caches after a successful toggle", () => {
    renderWithIntl(<ShoppingItem item={baseItem} listId="list-1" />);

    updateItemOptions.onSuccess?.();

    expect(getByIdInvalidate).toHaveBeenCalledWith({ id: "list-1" });
    expect(listInvalidate).toHaveBeenCalledTimes(1);
  });
});
