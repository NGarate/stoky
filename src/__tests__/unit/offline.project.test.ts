import { describe, it, expect } from "bun:test";
import {
  pendingProductIds,
  projectShoppingItems,
  projectStockTotals,
} from "@/lib/offline/project";
import type { QueuedOp, ReplayablePath } from "@/lib/offline/queue";

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
function op(path: ReplayablePath, input: Record<string, unknown>): QueuedOp {
  counter += 1;
  return {
    id: `op-${counter}`,
    path,
    input,
    householdId: "h1",
    label: { key: "offline.change" },
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

  it("drops a row whose removal is waiting", () => {
    const projected = projectShoppingItems(rows, [
      op("shopping.removeItem", { id: "b" }),
    ]);

    expect(projected.map((row) => row.id)).toEqual(["a"]);
  });

  it("shows an item added offline, under the operation's own id", () => {
    const added = op("shopping.addItem", {
      shoppingListId: "list-1",
      customName: "Pan",
    });

    const projected = projectShoppingItems(rows, [added], "list-1");

    // Its own id, never a server id: it must be showable and never mistaken
    // for a row the server knows about.
    expect(projected.map((row) => row.id)).toEqual(["a", "b", added.id]);
    expect(projected.find((row) => row.id === added.id)?.pending).toBe(true);
  });

  it("does not put an item added to one list into another", () => {
    const added = op("shopping.addItem", {
      shoppingListId: "list-2",
      customName: "Pan",
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
    expect(pendingProductIds([op("shopping.removeItem", { id: "a" })]).size).toBe(0);
  });
});
