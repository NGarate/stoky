import { canonicalCount } from "@/lib/inventory/units";
import type { QueuedOp } from "./queue";

/**
 * What the screen shows: the server's answer with the unsent changes folded on
 * top.
 *
 * **Derived from the queue rather than written into the cache**, and the
 * difference matters. An optimistic cache write is a second copy of the same
 * intention that can drift from the queue — roll one back and not the other and
 * the screen and the queue disagree, with no way to tell which is right.
 * Folding at render has one source: if it is in the queue it shows, and when it
 * leaves the queue it stops showing, with nothing to keep in step.
 *
 * **This is also what stops a double count**, which is the largest correctness
 * hole a queue like this has. Without it: someone ticks three items, iOS
 * discards the tab, they reopen the app, the list renders the server's
 * untouched rows — so the ticks look lost — and they tick again. The second set
 * carries *different* keys, because they are genuinely new taps, so idempotency
 * cannot catch them. Applied to `addStock`/`consumeStock` that is a real double
 * count of stock.
 */

/** A shopping row as the server knows it, plus whether a change is in flight. */
export interface ProjectedItem {
  id: string;
  isChecked: boolean;
  /** True when an unsent change is responsible for the state shown. */
  pending: boolean;
  /**
   * True when the row *is* an unsent addition, so its `id` is the queued
   * change's id and no row the server knows about.
   *
   * The screens have to know, because every other control on a row writes
   * against that id: a tick or a removal sent with it was refused by the
   * server as a row that does not exist — the tick lost, and the item the
   * person had just taken back off the list added anyway once the addition
   * drained. Such a row is taken back by cancelling the addition, and is
   * edited once it has been sent.
   */
  queued: boolean;
}

interface ServerItem {
  id: string;
  isChecked: boolean;
}

/**
 * Fold the queue over one list's rows.
 *
 * Removals drop out, ticks apply, and an addition composed offline appears with
 * the operation's own id — so it can be shown, but never mistaken for a row the
 * server knows about.
 */
export function projectShoppingItems<T extends ServerItem>(
  items: readonly T[],
  pending: readonly QueuedOp[],
  listId?: string,
): (T & ProjectedItem)[] {
  const projected = new Map<string, T & ProjectedItem>(
    items.map((item) => [item.id, { ...item, pending: false, queued: false }]),
  );

  for (const op of pending) {
    const input = op.input as {
      id?: unknown;
      isChecked?: unknown;
      shoppingListId?: unknown;
    };

    if (op.path === "shopping.updateItem" && typeof input.id === "string") {
      const existing = projected.get(input.id);
      if (existing && typeof input.isChecked === "boolean") {
        projected.set(input.id, {
          ...existing,
          isChecked: input.isChecked,
          pending: true,
        });
      }
      continue;
    }

    if (op.path === "shopping.removeItem" && typeof input.id === "string") {
      projected.delete(input.id);
      continue;
    }

    if (op.path === "shopping.addItem") {
      // Scoped to the list being looked at, or an item added to one list would
      // appear in every list.
      if (listId !== undefined && input.shoppingListId !== listId) continue;

      // The name comes from the op's own label.
      //
      // `shopping.addItem`'s input carries a `productId` and no name — the
      // server joins it — so a row composed offline arrived with nothing to
      // call it: `/shopping/[id]` drew the placeholder "Nombre del artículo"
      // and `/shopping` drew an empty line and then labelled its tick
      // "Marcaste «undefined»". The op does know the name, because it is
      // what its own label says, and that label is minted at the call site
      // where the product was chosen.
      //
      // Written into both shapes because the two screens read different
      // ones: the list detail joins a product and reads `product.name`,
      // while `getBuyList` flattens and reads `name`.
      const named = op.label.values?.name;
      const name = typeof named === "string" ? named : undefined;

      projected.set(op.id, {
        ...(op.input as unknown as T),
        ...(name === undefined ? {} : { name, product: { name } }),
        id: op.id,
        isChecked: false,
        pending: true,
        queued: true,
      });
    }
  }

  return [...projected.values()];
}

/** Net stock per product id, as the screen should show it. */
export function projectStockTotals(
  totals: ReadonlyMap<string, number>,
  pending: readonly QueuedOp[],
): Map<string, number> {
  const projected = new Map(totals);

  for (const op of pending) {
    const input = op.input as { productId?: unknown; quantity?: unknown; unit?: unknown };
    if (typeof input.productId !== "string") continue;
    if (typeof input.quantity !== "number") continue;

    const quantity = typeof input.unit === "string"
      ? canonicalCount({ quantity: input.quantity, unit: input.unit }).quantity
      : input.quantity;
    const current = projected.get(input.productId) ?? 0;

    if (op.path === "inventory.addStock") {
      projected.set(input.productId, round(current + Math.abs(quantity)));
    } else if (op.path === "inventory.consumeStock") {
      projected.set(input.productId, round(current - Math.abs(quantity)));
    }
  }

  return projected;
}

/**
 * What is on the household's lists per product, with unsent additions folded
 * in.
 *
 * Same shape as `projectStockTotals` and for the same reason: the queue is the
 * optimistic layer, not the cache. Without this, tapping "Apuntar" offline
 * leaves the button lit — the server has not heard yet — and a second tap
 * writes a second item.
 *
 * **A queued removal is not folded back out, and cannot be.**
 * `shopping.removeItem` carries only `{ id }`, so nothing in the queue says
 * which product it frees or how much. A removal composed without a signal
 * therefore keeps its product suppressed until the queue drains. Widening that
 * procedure's input would touch `ReplayablePath` and both replayable tests,
 * which is a large blast radius for a case measured in seconds — so it is
 * accepted, and written down rather than discovered.
 */
export function projectOnListQuantities(
  quantities: ReadonlyMap<string, number>,
  pending: readonly QueuedOp[],
): Map<string, number> {
  const projected = new Map(quantities);

  for (const op of pending) {
    if (op.path !== "shopping.addItem") continue;
    const input = op.input as { productId?: unknown; quantity?: unknown; unit?: unknown };
    if (typeof input.productId !== "string") continue;
    const amount = typeof input.quantity === "number" ? input.quantity : 1;
    const quantity = typeof input.unit === "string"
      ? canonicalCount({ quantity: amount, unit: input.unit }).quantity : amount;
    projected.set(
      input.productId,
      round((projected.get(input.productId) ?? 0) + quantity),
    );
  }

  return projected;
}

/** Quantities are entered by people, to two decimals at most. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The product ids a queued change would move, for highlighting a row. */
export function pendingProductIds(pending: readonly QueuedOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of pending) {
    if (op.path !== "inventory.addStock" && op.path !== "inventory.consumeStock") {
      continue;
    }
    const productId = (op.input as { productId?: unknown }).productId;
    if (typeof productId === "string") ids.add(productId);
  }
  return ids;
}
