import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import {
  shoppingListSchema,
  updateShoppingListSchema,
  shoppingItemSchema,
  updateShoppingItemSchema,
  shoppingListQuerySchema,
} from "@/lib/validations/shopping";

export const shoppingRouter = createTRPCRouter({
  list: protectedProcedure
    .input(shoppingListQuerySchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not associated with a household");
      }

      const lists = await prisma.shoppingList.findMany({
        where: {
          householdId: user.householdId,
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

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not associated with a household");
      }

      const list = await prisma.shoppingList.findFirst({
        where: {
          id: input.id,
          householdId: user.householdId,
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
        throw new Error("Shopping list not found");
      }

      return list;
    }),

  create: protectedProcedure
    .input(shoppingListSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not associated with a household");
      }

      const list = await prisma.shoppingList.create({
        data: {
          ...input,
          householdId: user.householdId,
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

  update: protectedProcedure
    .input(updateShoppingListSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not associated with a household");
      }

      const { id, ...data } = input;

      const list = await prisma.shoppingList.update({
        where: {
          id,
          householdId: user.householdId,
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

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not associated with a household");
      }

      await prisma.shoppingList.delete({
        where: {
          id: input.id,
          householdId: user.householdId,
        },
      });

      return { success: true };
    }),

  addItem: protectedProcedure
    .input(shoppingItemSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not associated with a household");
      }

      // Verify list belongs to household
      const list = await prisma.shoppingList.findFirst({
        where: {
          id: input.shoppingListId,
          householdId: user.householdId,
        },
      });

      if (!list) {
        throw new Error("Shopping list not found");
      }

      // If productId is provided, verify it belongs to household
      if (input.productId) {
        const product = await prisma.product.findFirst({
          where: {
            id: input.productId,
            householdId: user.householdId,
          },
        });

        if (!product) {
          throw new Error("Product not found");
        }
      }

      const item = await prisma.shoppingItem.create({
        data: input,
        include: {
          product: true,
        },
      });

      return item;
    }),

  updateItem: protectedProcedure
    .input(updateShoppingItemSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not associated with a household");
      }

      const { id, ...data } = input;

      const item = await prisma.shoppingItem.update({
        where: {
          id,
          shoppingList: {
            householdId: user.householdId,
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

  removeItem: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not associated with a household");
      }

      await prisma.shoppingItem.delete({
        where: {
          id: input.id,
          shoppingList: {
            householdId: user.householdId,
          },
        },
      });

      return { success: true };
    }),

  generateFromLowStock: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { householdId: true },
    });

    if (!user?.householdId) {
      throw new Error("User not associated with a household");
    }

    // Get or create auto-generated list
    let autoList = await prisma.shoppingList.findFirst({
      where: {
        householdId: user.householdId,
        isAutoGenerated: true,
      },
      include: {
        items: true,
      },
    });

    if (!autoList) {
      autoList = await prisma.shoppingList.create({
        data: {
          name: "Lista automática - Stock bajo",
          isAutoGenerated: true,
          householdId: user.householdId,
        },
        include: {
          items: true,
        },
      });
    }

    // Find products with low stock
    const products = await prisma.product.findMany({
      where: {
        householdId: user.householdId,
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
        await prisma.shoppingItem.create({
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
    return prisma.shoppingList.findUnique({
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

  getAutoList: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { householdId: true },
    });

    if (!user?.householdId) {
      throw new Error("User not associated with a household");
    }

    const autoList = await prisma.shoppingList.findFirst({
      where: {
        householdId: user.householdId,
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
