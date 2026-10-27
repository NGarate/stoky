import { describe, it, expect } from "bun:test";
import { Decimal } from "@prisma/client-runtime-utils";
import { pendingProductIds, projectShoppingItems } from "@/lib/offline/project";
import * as project from "@/lib/offline/project";
import type { QueuedOp, ReplayablePath } from "@/lib/offline/queue";

// The totals are Decimals; these cases read as plain numbers.
const decimals = (totals: ReadonlyMap<string, number>) =>
  new Map([...totals].map(([id, value]) => [id, new Decimal(value)]));
const numbers = (totals: ReadonlyMap<string, Decimal>) =>
  new Map([...totals].map(([id, value]) => [id, value.toNumber()]));
const projectStockTotals = (
  totals: ReadonlyMap<string, number>,
  pending: readonly QueuedOp[],
) => numbers(project.projectStockTotals(decimals(totals), pending));
const projectOnListQuantities = (
  totals: ReadonlyMap<string, number>,
  pending: readonly QueuedOp[],
) => numbers(project.projectOnListQuantities(decimals(totals), pending));

/**
 * The fold that makes a queued change visible before it is sent.
 *
 * Its real job is preventing a double count. Without it: someone ticks three
 * items, iOS discards the tab, they reopen the app, the list renders the
 * server's untouched rows — so the ticks look lost — and they tick again. The
 * second set carries *different* keys, because they are genuinely new taps, so
 * idempotency cannot catch them. On stock that is a real double count.
 */

let counter = 0;
function op(
  path: ReplayablePath,
  input: Record<string, unknown>,
  label: QueuedOp["label"] = { key: "offline.change" },
): QueuedOp {
  counter += 1;
  return {
    id: `op-${counter}`,
    path,
    input,
    householdId: "h1",
    label,
    createdAt: new Date("2026-08-11T10:00:00.000Z"),
    attempts: 0,
  };
}

describe("projectShoppingItems", () => {
  const rows = [
    { id: "a", isChecked: false, name: "Leche" },
    { id: "b", isChecked: false, name: "Café" },
  ];

  it("shows the server's rows when nothing is waiting", () => {
    const projected = projectShoppingItems(rows, []);

    expect(projected.map((row) => row.id)).toEqual(["a", "b"]);
    expect(projected.every((row) => !row.pending)).toBe(true);
  });

  it("shows a queued tick as ticked", () => {
    const projected = projectShoppingItems(rows, [
      op("shopping.updateItem", { id: "a", isChecked: true }),
    ]);

    expect(projected.find((row) => row.id === "a")?.isChecked).toBe(true);
    expect(projected.find((row) => row.id === "a")?.pending).toBe(true);
    expect(projected.find((row) => row.id === "b")?.isChecked).toBe(false);
  });

  it("shows a queued untick as unticked", () => {
    const checked = [{ id: "a", isChecked: true, name: "Leche" }];

    const projected = projectShoppingItems(checked, [
      op("shopping.updateItem", { id: "a", isChecked: false }),
    ]);

    expect(projected[0]?.isChecked).toBe(false);
  });

  it("shows a shop chosen offline, so the picker does not snap back", () => {
    // The picker is controlled by the row's `storeId`. Only ticks were
    // folded, so a shop chosen with no signal reverted the moment it was
    // chosen, and choosing it again queued a second write.
    const withStore = [
      { id: "a", isChecked: false, storeId: "s1" as string | null },
    ];

    const projected = projectShoppingItems(withStore, [
      op("shopping.updateItem", { id: "a", storeId: "s2" }),
    ]);

    expect(projected[0]?.storeId).toBe("s2");
    expect(projected[0]?.pending).toBe(true);
  });

  it("shows a shop cleared offline as cleared", () => {
    const withStore = [
      { id: "a", isChecked: false, storeId: "s1" as string | null },
    ];

    const projected = projectShoppingItems(withStore, [
      op("shopping.updateItem", { id: "a", storeId: null }),
    ]);

    expect(projected[0]?.storeId).toBeNull();
  });

  it("shows a quantity changed offline", () => {
    const withQuantity = [
      { id: "a", isChecked: false, quantity: new Decimal(1) },
    ];

    const projected = projectShoppingItems(withQuantity, [
      op("shopping.updateItem", { id: "a", quantity: 3, quantityUnit: "L" }),
    ]);

    // In the server's shape: the row is drawn with `.toString()` and
    // compared with `.equals()`, which a queued number does not have.
    expect(projected[0]?.quantity).toBeInstanceOf(Decimal);
    expect(projected[0]?.quantity.toString()).toBe("3");
    expect(projected[0]?.isChecked).toBe(false);
  });

  it("drops a row whose removal is waiting", () => {
    const projected = projectShoppingItems(rows, [
      op("shopping.removeItem", { id: "b" }),
    ]);

    expect(projected.map((row) => row.id)).toEqual(["a"]);
  });

  it("shows an item added offline, under the operation's own id", () => {
    const added = op("shopping.addItem", {
      shoppingListId: "list-1",
      productId: "p-pan",
    });

    const projected = projectShoppingItems(rows, [added], "list-1");

    // Its own id, never a server id: it must be showable and never mistaken
    // for a row the server knows about.
    expect(projected.map((row) => row.id)).toEqual(["a", "b", added.id]);
    expect(projected.find((row) => row.id === added.id)?.pending).toBe(true);
  });

  it("marks an addition as queued, so no control writes against its id", () => {
    // A tick or a removal sent with the operation's id is refused by the
    // server as a row that does not exist. The screens can only avoid that if
    // the row says what it is.
    const added = op("shopping.addItem", {
      shoppingListId: "list-1",
      productId: "p",
    });

    const projected = projectShoppingItems(rows, [added], "list-1");

    expect(projected.find((row) => row.id === added.id)?.queued).toBe(true);
    expect(projected.find((row) => row.id === "a")?.queued).toBe(false);
  });

  it("gives an item added offline the name it was added under", () => {
    const added = op(
      "shopping.addItem",
      { shoppingListId: "list-1", productId: "p-pan", quantity: 1 },
      { key: "offline.addedItem", values: { name: "Pan de centeno" } },
    );

    const row = projectShoppingItems(rows, [added], "list-1").find(
      (candidate) => candidate.id === added.id,
    ) as { name?: string; product?: { name: string } } | undefined;

    // The input carries a `productId` and no name — the server joins it — so
    // a row composed offline had nothing to call itself. `/shopping/[id]`
    // drew the placeholder "Nombre del artículo" and `/shopping` drew an
    // empty line and then labelled its tick "Marcaste «undefined»". Both
    // shapes, because the two screens read different ones.
    expect(row?.name).toBe("Pan de centeno");
    expect(row?.product?.name).toBe("Pan de centeno");
  });

  it("gives an item added offline its quantity in the server's shape", () => {
    const added = op("shopping.addItem", {
      shoppingListId: "list-1",
      productId: "p-pan",
      quantity: 2,
    });
    const tapped = op("shopping.addItem", {
      shoppingListId: "list-1",
      productId: "p-sal",
    });

    const projected = projectShoppingItems(rows, [added, tapped], "list-1");
    const quantityOf = (id: string) =>
      (
        projected.find((row) => row.id === id) as
          { quantity?: unknown } | undefined
      )?.quantity;

    // The queue holds the number typed; the row it becomes is drawn by the
    // same code as the server's rows, which calls `.toString()` on it.
    expect(quantityOf(added.id)).toEqual(new Decimal(2));
    expect(quantityOf(tapped.id)).toEqual(new Decimal(1));
  });

  it("leaves an unnamed addition alone rather than inventing one", () => {
    const added = op("shopping.addItem", {
      shoppingListId: "list-1",
      productId: "p-pan",
    });

    const row = projectShoppingItems(rows, [added], "list-1").find(
      (candidate) => candidate.id === added.id,
    ) as { name?: string } | undefined;

    expect(row?.name).toBeUndefined();
  });

  it("does not put an item added to one list into another", () => {
    const added = op("shopping.addItem", {
      shoppingListId: "list-2",
      productId: "p-pan",
    });

    expect(projectShoppingItems(rows, [added], "list-1")).toHaveLength(2);
  });

  it("applies the last of two changes to the same row", () => {
    const projected = projectShoppingItems(rows, [
      op("shopping.updateItem", { id: "a", isChecked: true }),
      op("shopping.updateItem", { id: "a", isChecked: false }),
    ]);

    expect(projected.find((row) => row.id === "a")?.isChecked).toBe(false);
  });

  it("lets a removal win over an earlier tick on the same row", () => {
    const projected = projectShoppingItems(rows, [
      op("shopping.updateItem", { id: "a", isChecked: true }),
      op("shopping.removeItem", { id: "a" }),
    ]);

    expect(projected.map((row) => row.id)).toEqual(["b"]);
  });

  it("ignores a change to a row this list does not have", () => {
    const projected = projectShoppingItems(rows, [
      op("shopping.updateItem", { id: "elsewhere", isChecked: true }),
    ]);

    expect(projected).toHaveLength(2);
  });

  it("ignores stock changes entirely", () => {
    const projected = projectShoppingItems(rows, [
      op("inventory.consumeStock", { productId: "p1", quantity: 1 }),
    ]);

    expect(projected.every((row) => !row.pending)).toBe(true);
  });
});

describe("projectStockTotals", () => {
  it("converts an old queued dozen input to the migrated stock unit", () => {
    const projected = projectStockTotals(new Map([["eggs", 36]]), [
      op("inventory.consumeStock", {
        productId: "eggs",
        quantity: 1,
        unit: "docena",
      }),
      op("inventory.consumeStock", {
        productId: "eggs",
        quantity: 1,
        unit: "unidad",
      }),
    ]);
    expect(projected.get("eggs")).toBe(23);
  });

  const totals = new Map([
    ["milk", 6],
    ["coffee", 2],
  ]);

  it("leaves the server's figures alone when nothing is waiting", () => {
    expect(projectStockTotals(totals, [])).toEqual(totals);
  });

  it("raises a total for a queued purchase", () => {
    const projected = projectStockTotals(totals, [
      op("inventory.addStock", { productId: "milk", quantity: 2 }),
    ]);

    expect(projected.get("milk")).toBe(8);
  });

  it("lowers a total for a queued consumption", () => {
    const projected = projectStockTotals(totals, [
      op("inventory.consumeStock", { productId: "milk", quantity: 2 }),
    ]);

    expect(projected.get("milk")).toBe(4);
  });

  it("composes two queued consumptions rather than overwriting", () => {
    // The case that would double-count if the fold overwrote: two taps of
    // "used one" must be two, not one.
    const projected = projectStockTotals(totals, [
      op("inventory.consumeStock", { productId: "milk", quantity: 1 }),
      op("inventory.consumeStock", { productId: "milk", quantity: 1 }),
    ]);

    expect(projected.get("milk")).toBe(4);
  });

  it("treats a signed quantity as its magnitude", () => {
    // `consumeStock` accepts either sign and takes the absolute value; the
    // projection has to agree, or the screen and the server diverge.
    const projected = projectStockTotals(totals, [
      op("inventory.consumeStock", { productId: "milk", quantity: -2 }),
    ]);

    expect(projected.get("milk")).toBe(4);
  });

  it("starts a product the server has never seen at zero", () => {
    const projected = projectStockTotals(totals, [
      op("inventory.addStock", { productId: "bread", quantity: 1 }),
    ]);

    expect(projected.get("bread")).toBe(1);
  });

  it("leaves untouched products untouched", () => {
    const projected = projectStockTotals(totals, [
      op("inventory.consumeStock", { productId: "milk", quantity: 1 }),
    ]);

    expect(projected.get("coffee")).toBe(2);
  });

  it("does not leave a rounding crumb", () => {
    const projected = projectStockTotals(new Map([["oil", 0.3]]), [
      op("inventory.consumeStock", { productId: "oil", quantity: 0.1 }),
      op("inventory.consumeStock", { productId: "oil", quantity: 0.2 }),
    ]);

    expect(projected.get("oil")).toBe(0);
  });

  it("can show a negative total, because that is what was asked for", () => {
    // The server refuses this and the screen must not pretend otherwise — a
    // clamp here would hide the disagreement the reconciliation exists for.
    const projected = projectStockTotals(new Map([["milk", 1]]), [
      op("inventory.consumeStock", { productId: "milk", quantity: 2 }),
    ]);

    expect(projected.get("milk")).toBe(-1);
  });
});

describe("pendingProductIds", () => {
  it("names the products a queued change would move", () => {
    const ids = pendingProductIds([
      op("inventory.addStock", { productId: "milk", quantity: 1 }),
      op("inventory.consumeStock", { productId: "coffee", quantity: 1 }),
      op("shopping.updateItem", { id: "a", isChecked: true }),
    ]);

    expect([...ids].sort()).toEqual(["coffee", "milk"]);
  });

  it("is empty when only list changes are waiting", () => {
    expect(
      pendingProductIds([op("shopping.removeItem", { id: "a" })]).size,
    ).toBe(0);
  });
});

describe("what the lists already cover", () => {
  const add = (productId: string, quantity: number): QueuedOp => ({
    id: `op-${productId}`,
    path: "shopping.addItem",
    input: { shoppingListId: "l1", productId, quantity, unit: "L" },
    householdId: "h1",
    label: { key: "offline.addedItem" },
    createdAt: new Date("2026-08-18T10:00:00.000Z"),
    attempts: 0,
  });

  it("folds an unsent addition into what the server reported", () => {
    const projected = projectOnListQuantities(new Map([["p1", 2]]), [
      add("p1", 3),
    ]);

    expect(projected.get("p1")).toBe(5);
  });

  it("counts a product the server has never seen on a list", () => {
    const projected = projectOnListQuantities(new Map(), [add("p9", 1)]);

    expect(projected.get("p9")).toBe(1);
  });

  it("defaults a missing quantity to one, which is what a tap means", () => {
    const op = add("p1", 1);
    const projected = projectOnListQuantities(new Map(), [
      { ...op, input: { shoppingListId: "l1", productId: "p1" } },
    ]);

    expect(projected.get("p1")).toBe(1);
  });

  it("ignores a queued change that is not an addition", () => {
    const projected = projectOnListQuantities(new Map([["p1", 2]]), [
      { ...add("p1", 5), path: "shopping.removeItem" },
    ]);

    // A queued removal carries only an id, so nothing here knows which
    // product it frees. Its product stays suppressed until the queue drains,
    // which is stated in the function rather than discovered.
    expect(projected.get("p1")).toBe(2);
  });

  it("adds exactly: 0.1 and 0.2 are 0.3", () => {
    const projected = projectOnListQuantities(new Map([["p1", 0.1]]), [
      add("p1", 0.2),
    ]);

    expect(projected.get("p1")).toBe(0.3);
  });

  it("leaves what it was given alone", () => {
    const original = new Map([["p1", 2]]);
    projectOnListQuantities(original, [add("p1", 3)]);

    expect(original.get("p1")).toBe(2);
  });
});
