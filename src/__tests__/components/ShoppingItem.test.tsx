import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";

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

    expect(updateItemMutate).toHaveBeenCalledWith({
      id: "item-1",
      isChecked: true,
    });
  });

  it("toggles a checked item back to unchecked", async () => {
    renderWithIntl(
      <ShoppingItem item={{ ...baseItem, isChecked: true }} listId="list-1" />,
    );

    await userEvent.click(screen.getByRole("checkbox"));

    expect(updateItemMutate).toHaveBeenCalledWith({
      id: "item-1",
      isChecked: false,
    });
  });

  it("removes the item via the labelled delete control", async () => {
    renderWithIntl(<ShoppingItem item={baseItem} listId="list-1" />);

    // shopping.removeItem in messages/es.json
    await userEvent.click(
      screen.getByRole("button", { name: "Eliminar artículo" }),
    );

    expect(removeItemMutate).toHaveBeenCalledWith({ id: "item-1" });
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
