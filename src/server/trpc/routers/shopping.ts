import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, householdProcedure, writeProcedure } from "../trpc";
import {
  shoppingListSchema,
  updateShoppingListSchema,
  shoppingItemSchema,
  updateShoppingItemSchema,
  shoppingListQuerySchema,
} from "@/lib/validations/shopping";
import { replayable } from "@/lib/validations/idempotency";
import { withReplay } from "../replay";

export const shoppingRouter = createTRPCRouter({
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

  create: writeProcedure
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

  delete: writeProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.shoppingList.delete({
        where: {
          id: input.id,
          householdId: ctx.householdId,
        },
      });

      return { success: true };
    }),

  addItem: writeProcedure
    .input(shoppingItemSchema.merge(replayable))
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

      // If productId is provided, verify it belongs to household
      if (input.productId) {
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
      }

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

  updateItem: writeProcedure
    .input(updateShoppingItemSchema.merge(replayable))
    .mutation(async ({ ctx, input }) => {
      // Same trap as `addItem`: this spread everything but `id` into Prisma.
      const { id, idempotencyKey, composedByUserId, ...data } = input;

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

    const lowStockProducts = products.filter((product) => {
      const currentStock = product.stockEntries.reduce(
        (sum, entry) => sum + entry.quantity,
        0
      );
      return currentStock < (product.minStock || 0);
    });

    // Add items to auto list (avoiding duplicates)
    const existingProductIds = new Set(
      autoList.items.map((item) => item.productId).filter(Boolean)
    );

    for (const product of lowStockProducts) {
      if (!existingProductIds.has(product.id)) {
        await ctx.db.shoppingItem.create({
          data: {
            shoppingListId: autoList.id,
            productId: product.id,
            quantity: (product.minStock || 0) * 1.5, // Suggest 1.5x minimum stock
            unit: product.defaultUnit,
          },
        });
      }
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
