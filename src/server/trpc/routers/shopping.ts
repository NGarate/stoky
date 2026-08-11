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

export const shoppingRouter = createTRPCRouter({
  list: householdProcedure
    .input(shoppingListQuerySchema)
    .query(async ({ ctx, input }) => {
      const lists = await ctx.db.shoppingList.findMany({
        where: {
          householdId: ctx.householdId,
          ...(!input.includeCompleted && {
            items: {
              some: {
                isChecked: false,
              },
            },
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
    .input(shoppingItemSchema)
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

      const item = await ctx.db.shoppingItem.create({
        data: input,
        include: {
          product: true,
        },
      });

      return item;
    }),

  updateItem: writeProcedure
    .input(updateShoppingItemSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const item = await ctx.db.shoppingItem.update({
        where: {
          id,
          shoppingList: {
            householdId: ctx.householdId,
          },
        },
        data: {
          ...data,
          ...(data.isChecked !== undefined && {
            checkedAt: data.isChecked ? new Date() : null,
          }),
        },
        include: {
          product: true,
        },
      });

      return item;
    }),

  removeItem: writeProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.shoppingItem.delete({
        where: {
          id: input.id,
          shoppingList: {
            householdId: ctx.householdId,
          },
        },
      });

      return { success: true };
    }),

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
