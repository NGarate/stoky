import { TRPCError } from "@trpc/server";
import { type PrismaClient } from "@prisma/client";
import { needsMoreOnList } from "@/lib/stock/low-stock";
import { z } from "zod";
import { createTRPCRouter, householdProcedure, writeProcedure } from "../trpc";
import {
  shoppingListSchema,
  updateShoppingListSchema,
  addShoppingItemSchema,
  updateShoppingItemSchema,
  shoppingListQuerySchema,
} from "@/lib/validations/shopping";
import { replayable } from "@/lib/validations/idempotency";
import { withReplay } from "../replay";

/**
 * Shopping lists, and the screen that reads across all of them.
 *
 * **Two shapes of thing live here.** Seven procedures manage lists and their
 * items in the obvious way. The last three do not: `generateFromLowStock`,
 * `getBuyList` and `getAutoList` exist for the phone screen, which does not
 * think in lists at all — it asks "what do I need to buy", and the answer is
 * drawn from stock levels rather than from anything anybody typed.
 *
 * **The three item procedures are replayable**, because they are what a person
 * does in a supermarket with no signal: add, tick off, remove. Phase 4's queue
 * may send each of them twice, so they carry an `idempotencyKey` and apply once
 * (`src/server/trpc/replay.ts`).
 *
 * An item always references a `Product` (D103, 2026-08-22). Free text read
 * like the obvious kindness and cost more than it gave: an item naming
 * nothing the household knows cannot be priced, counted against stock,
 * matched to a receipt line, or suppressed when it is already covered. The
 * kindness moved to the add form, which creates the product inline — the
 * schema (`src/lib/validations/shopping.ts`) is where the rule is enforced,
 * and an item with neither field once reached the phone screen as a tickable
 * empty row (SHOP-1).
 */
/**
 * A store this household owns, or a refusal — before anything is written.
 *
 * `addItem` and `updateItem` both take a `storeId` from the client and both
 * wrote it into the row unread. The list and the product were checked against
 * `ctx.householdId`; the store was the one that was not. So a MEMBER of one
 * household could name another household's `Store`, and `shopping.list`
 * includes the store — which handed that household's name and address back
 * inside a response the caller had every right to read.
 *
 * This is the same hole, on the same field, that SEC-1 closed for
 * `inventory.addStock`, and that `price.recordPrice` has guarded since it was
 * written. Two sibling procedures had the check and these two did not, which
 * is the argument for one function rather than a third copy of the paragraph.
 *
 * `null` and `undefined` pass without a query: "anywhere" names no row, so
 * there is nothing to own.
 */
async function assertStoreIsOurs(
  ctx: { db: PrismaClient; householdId: string },
  storeId: string | null | undefined,
): Promise<void> {
  if (!storeId) return;

  const store = await ctx.db.store.findFirst({
    where: { id: storeId, householdId: ctx.householdId },
    select: { id: true },
  });

  if (!store) {
    // NOT_FOUND rather than FORBIDDEN, deliberately: the two siblings answer
    // this way, and a household that cannot see a store should not be told
    // the difference between "no such store" and "not yours".
    throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
  }
}

export const shoppingRouter = createTRPCRouter({
  /** The household's lists, with a count of what is still unticked. */
  list: householdProcedure
    .input(shoppingListQuerySchema)
    .query(async ({ ctx, input }) => {
      const lists = await ctx.db.shoppingList.findMany({
        where: {
          householdId: ctx.householdId,
          ...(!input.includeCompleted && {
            // "Not completed" is not the same as "has something unticked".
            // The filter used to be `items: { some: { isChecked: false } }`,
            // which also hid every list with **no items at all** — so
            // creating one made it vanish, and "Crear lista" looked like it
            // did nothing. A list nobody has added to is new, not finished.
            OR: [
              { items: { none: {} } },
              { items: { some: { isChecked: false } } },
            ],
          }),
        },
        include: {
          items: {
            include: {
              // No `store`. Its two callers are the lists index and the
              // kitchen, and neither draws one — so it was a whole Store row,
              // name and address, fetched onto two screens that show none of
              // it. For a privacy-first application the default is to send
              // what is read, not what might be.
              product: true,
            },
            orderBy: {
              id: "asc",
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return lists;
    }),

  /** One list with its items, for the list detail screen. */
  getById: householdProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const list = await ctx.db.shoppingList.findFirst({
        where: {
          id: input.id,
          householdId: ctx.householdId,
        },
        include: {
          items: {
            include: {
              product: true,
              // The row names where to buy it, and this is the query the row
              // is drawn from. The include went onto `list` instead, which
              // nothing renders — so a reader who cannot edit was told every
              // item could be bought anywhere.
              store: true,
            },
            orderBy: {
              id: "asc",
            },
          },
        },
      });

      if (!list) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Shopping list not found",
        });
      }

      return list;
    }),

  /**
   * A new, empty list. Named by the person; the automatic one names itself.
   *
   * `householdProcedure`, not `writeProcedure`, since the owner's pass
   * (REDESIGN_PLAN §5.2 amendment, D88): a kitchen account may write down
   * what is needed. Same tier and same reasoning as `consumeStock` — the
   * capability test asserts the widening is exactly these two procedures.
   */
  create: householdProcedure
    .input(shoppingListSchema)
    .mutation(async ({ ctx, input }) => {
      const list = await ctx.db.shoppingList.create({
        data: {
          ...input,
          householdId: ctx.householdId,
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      return list;
    }),

  /** Renames a list. */
  update: writeProcedure
    .input(updateShoppingListSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const list = await ctx.db.shoppingList.update({
        where: {
          id,
          householdId: ctx.householdId,
        },
        data,
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      return list;
    }),

  /**
   * Removes a list and its items.
   *
   * Unlike `product.delete`, this one really does cascade — a shopping item has
   * no history worth keeping and nothing else references it. **The cascade is
   * performed here, because the database does not do it**: `ShoppingItem`'s
   * foreign key is `ON DELETE RESTRICT`, and the schema has no cascades
   * anywhere by design.
   *
   * That gap was not theoretical. `shoppingList.delete` on a list with anything
   * on it hit the constraint, and the translation turned it into `BAD_REQUEST`,
   * *"That refers to something that does not exist"* — about a list the person
   * was looking at. So deleting a shopping list worked only while it was empty,
   * which is not the state a list gets deleted in. The one test it had deleted
   * an empty one.
   */
  delete: writeProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Resolved against the household first. The item delete below is keyed on
      // the list alone — `ShoppingItem` has no `householdId` of its own — so the
      // ownership check has to happen before anything is removed rather than
      // being carried by the delete's own filter, which is how the previous
      // version did it.
      const list = await ctx.db.shoppingList.findFirst({
        where: { id: input.id, householdId: ctx.householdId },
        select: { id: true },
      });

      if (!list) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Shopping list not found",
        });
      }

      // One transaction: a list whose items were removed and which then failed
      // to delete would leave the household an empty list they had asked to be
      // rid of, and no way to tell that from one they had just emptied.
      await ctx.db.$transaction([
        ctx.db.shoppingItem.deleteMany({ where: { shoppingListId: list.id } }),
        ctx.db.shoppingList.delete({ where: { id: list.id } }),
      ]);

      return { success: true };
    }),

  /**
   * Puts something on a list, either a product or free text.
   *
   * Replayable: this is the one a person does while standing in front of the
   * shelf that reminded them.
   *
   * `householdProcedure` since the owner's pass (§5.2 amendment, D88): the
   * kitchen tablet is exactly where a household notices something needs
   * buying. Ticking off, renaming, deleting and generating stay refused.
   */
  addItem: householdProcedure
    .input(addShoppingItemSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify list belongs to household
      const list = await ctx.db.shoppingList.findFirst({
        where: {
          id: input.shoppingListId,
          householdId: ctx.householdId,
        },
      });

      if (!list) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Shopping list not found",
        });
      }

      // The product must be the household's own — the store two checks up
      // had the same rule and lacked it once (see the router docblock).
      const product = await ctx.db.product.findFirst({
        where: {
          id: input.productId,
          householdId: ctx.householdId,
        },
      });

      if (!product) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      }

      await assertStoreIsOurs(ctx, input.storeId);

      // The envelope is named out rather than spread. This resolver wrote
      // `data: input`, so merging anything into the schema would have reached
      // Prisma as `Unknown argument 'idempotencyKey'` — at runtime, with
      // nothing for the compiler to catch.
      const { idempotencyKey, composedByUserId, ...fields } = input;

      return withReplay(ctx, {
        key: idempotencyKey,
        composedByUserId,
        procedure: "shopping.addItem",
        input,
        apply: (tx) =>
          tx.shoppingItem.create({
            data: fields,
            include: { product: true },
          }),
        ids: (item) => [item.id],
        reread: async (db, ids) => {
          const item = await db.shoppingItem.findUnique({
            where: { id: ids[0] ?? "" },
            include: { product: true },
          });
          if (!item) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Shopping item not found",
            });
          }
          return item;
        },
      });
    }),

  /**
   * Changes an item — in practice, ticking it off.
   *
   * Replayable, and the most-replayed thing in the application: a trolley's
   * worth of ticks composed with no signal all arrive at once when it returns.
   * Ticking twice must leave it ticked once, which is what the idempotency key
   * buys.
   */
  updateItem: writeProcedure
    .input(updateShoppingItemSchema.merge(replayable))
    .mutation(async ({ ctx, input }) => {
      // Same trap as `addItem`: this spread everything but `id` into Prisma.
      const { id, idempotencyKey, composedByUserId, ...data } = input;

      // `data` is spread into the update, so an unchecked `storeId` reaches
      // the row the same way it did in `addItem`.
      await assertStoreIsOurs(ctx, data.storeId);

      return withReplay(ctx, {
        key: idempotencyKey,
        composedByUserId,
        procedure: "shopping.updateItem",
        input,
        apply: (tx) =>
          tx.shoppingItem.update({
            where: {
              id,
              shoppingList: { householdId: ctx.householdId },
            },
            data: {
              ...data,
              ...(data.isChecked !== undefined && {
                checkedAt: data.isChecked ? new Date() : null,
              }),
            },
            include: { product: true },
          }),
        ids: (item) => [item.id],
        reread: async (db, ids) => {
          const item = await db.shoppingItem.findUnique({
            where: { id: ids[0] ?? "" },
            include: { product: true },
          });
          if (!item) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Shopping item not found",
            });
          }
          return item;
        },
      });
    }),

  /** Takes something off a list. Replayable, for the same reason. */
  removeItem: writeProcedure
    .input(z.object({ id: z.string() }).merge(replayable))
    .mutation(async ({ ctx, input }) =>
      withReplay(ctx, {
        key: input.idempotencyKey,
        composedByUserId: input.composedByUserId,
        procedure: "shopping.removeItem",
        input,
        apply: async (tx) => {
          await tx.shoppingItem.delete({
            where: {
              id: input.id,
              shoppingList: { householdId: ctx.householdId },
            },
          });
          return { success: true as const };
        },
        // A delete leaves nothing to point at, and a replay of one is
        // answered by saying so again rather than by looking for the row.
        ids: () => [],
        reread: async () => ({ success: true as const }),
      }),
    ),

  /**
   * Refreshes the automatic list from what is running out.
   *
   * There is exactly one automatic list per household — `isAutoGenerated` — and
   * this creates it on first use. Every product whose net stock is under its
   * `minStock` goes on it, which is why `minStock` is the field that makes the
   * phone screen useful and why a product without one never appears.
   *
   * A mutation, so it is deliberate rather than something a page does on every
   * render: it writes rows a person will then tick off, and regenerating under
   * somebody mid-shop would be rude.
   */
  generateFromLowStock: writeProcedure.mutation(async ({ ctx }) => {
    // Get or create auto-generated list
    let autoList = await ctx.db.shoppingList.findFirst({
      where: {
        householdId: ctx.householdId,
        isAutoGenerated: true,
      },
      include: {
        items: true,
      },
    });

    if (!autoList) {
      autoList = await ctx.db.shoppingList.create({
        data: {
          name: "Lista automática - Stock bajo",
          isAutoGenerated: true,
          householdId: ctx.householdId,
        },
        include: {
          items: true,
        },
      });
    }

    // Find products with low stock
    const products = await ctx.db.product.findMany({
      where: {
        householdId: ctx.householdId,
        minStock: {
          not: null,
        },
      },
      include: {
        stockEntries: true,
      },
    });

    /**
     * What the household has already written down to buy, across every list.
     *
     * This procedure used to ask a narrower question: it skipped a product
     * only if that product was already on **its own** auto-generated list. So
     * anything somebody had written on a list of their own was offered again
     * here, and "Generar desde stock bajo" quietly duplicated the week's
     * shop. It was also a third definition of "already covered", alongside
     * the kitchen's and `getStockOverview`'s — which is exactly what
     * `low-stock.ts` was extracted to stop.
     *
     * Unticked only: a row already bought covers nothing.
     */
    const onList = await ctx.db.shoppingItem.groupBy({
      by: ["productId"],
      where: {
        isChecked: false,
        shoppingList: { householdId: ctx.householdId },
      },
      _sum: { quantity: true },
    });

    const alreadyOnList = new Map(
      onList.map((row) => [row.productId, row._sum.quantity ?? 0]),
    );

    // The same question the kitchen asks before it offers its button, and the
    // same function. It used to write its own `currentStock < (minStock || 0)`,
    // which reached a similar answer by a different route — agreement nothing
    // enforced.
    const needed = products.filter((product) =>
      needsMoreOnList(
        product.stockEntries.reduce((sum, entry) => sum + entry.quantity, 0),
        alreadyOnList.get(product.id) ?? 0,
        product.minStock,
      ),
    );

    /**
     * The auto list's own unticked rows, so a top-up amends rather than
     * duplicates.
     *
     * With the quantity rule, "already there" no longer decides on its own
     * whether to write — a product on the list at one of a minimum of two
     * still needs another one. Creating a second row for it would leave the
     * same product on the same list twice, which no screen can explain.
     */
    const existing = new Map(
      autoList.items
        .filter((item) => !item.isChecked)
        .map((item) => [item.productId, item]),
    );

    for (const product of needed) {
      const stock = product.stockEntries.reduce(
        (sum, entry) => sum + entry.quantity,
        0,
      );
      const covered = stock + (alreadyOnList.get(product.id) ?? 0);
      // 1.5× the minimum is the target to reach, not the amount to add: what
      // is in the cupboard and what is already written down both count
      // towards it. Rounded, because these are floats and "0.30000000000004
      // paquetes" is not a shopping list.
      const shortfall = Math.round(((product.minStock ?? 0) * 1.5 - covered) * 100) / 100;
      if (shortfall <= 0) continue;

      const row = existing.get(product.id);
      if (row) {
        await ctx.db.shoppingItem.update({
          where: { id: row.id },
          data: { quantity: row.quantity + shortfall },
        });
        continue;
      }

      await ctx.db.shoppingItem.create({
        data: {
          shoppingListId: autoList.id,
          productId: product.id,
          quantity: shortfall,
          unit: product.defaultUnit,
        },
      });
    }

    // Return updated list
    return ctx.db.shoppingList.findUnique({
      where: { id: autoList.id },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });
  }),

  /**
   * Everything the phone screen needs, in one query.
   *
   * `REDESIGN_PLAN.md` §3: the screen answers "what do I need to buy, and is
   * this thing in my hand a good buy?", so it wants one flat list of what is
   * outstanding — not a list of lists. Which list an item belongs to is a
   * filing decision, and filing is what `/shopping/lists` is for.
   *
   * Stock and the minimum come with each linked item because §3 shows them on
   * the row ("2/6 L"): standing in an aisle, "how much is at home" is the
   * question, and a second round trip per row to answer it is not an option
   * on a supermarket connection.
   */
  /**
   * Every item on every list, flattened, unticked first — the phone screen.
   *
   * Across all lists on purpose. Somebody in a supermarket wants one list of
   * what to buy, not a list of lists; which list an item came from is carried
   * along for context rather than as a way to navigate.
   *
   * Each item also carries its product's current stock and minimum, or null
   * where there is no product or no minimum — that null is what tells the
   * screen whether to draw the notch, so it is not an oversight.
   */
  getBuyList: householdProcedure.query(async ({ ctx }) => {
    const items = await ctx.db.shoppingItem.findMany({
      where: { shoppingList: { householdId: ctx.householdId } },
      include: {
        product: { include: { stockEntries: true } },
        shoppingList: { select: { id: true, name: true } },
      },
      orderBy: [{ isChecked: "asc" }, { id: "asc" }],
    });

    return items.map((item) => {
      const product = item.product;
      const stock = product
        ? Math.round(
            product.stockEntries.reduce((sum, entry) => sum + entry.quantity, 0) *
              100,
          ) / 100
        : null;

      return {
        id: item.id,
        name: product?.name ?? "",
        quantity: item.quantity,
        unit: item.unit ?? product?.defaultUnit ?? null,
        isChecked: item.isChecked,
        productId: item.productId,
        listId: item.shoppingList.id,
        listName: item.shoppingList.name,
        // Null when the product has no minimum: the screen shows a bar only
        // where there is a notch to show it against.
        stock,
        minStock: product?.minStock ?? null,
      };
    });
  }),

  /** The automatic list on its own, or null if `generateFromLowStock` has never run. */
  getAutoList: householdProcedure.query(async ({ ctx }) => {
    const autoList = await ctx.db.shoppingList.findFirst({
      where: {
        householdId: ctx.householdId,
        isAutoGenerated: true,
      },
        include: {
          items: {
            include: {
              product: true,
            },
            orderBy: {
              id: "asc",
            },
          },
        },
    });

    return autoList;
  }),
});
