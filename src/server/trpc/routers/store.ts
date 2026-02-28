import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import {
  storeSchema,
  updateStoreSchema,
  storeQuerySchema,
} from "@/lib/validations/store";

export const storeRouter = createTRPCRouter({
  list: protectedProcedure
    .input(storeQuerySchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not associated with a household");
      }

      const stores = await prisma.store.findMany({
        where: {
          householdId: user.householdId,
          ...(input.search && {
            name: {
              contains: input.search,
              mode: "insensitive",
            },
          }),
        },
        orderBy: { name: "asc" },
        take: input.limit,
      });

      return stores;
    }),

  create: protectedProcedure
    .input(storeSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { householdId: true },
      });

      if (!user?.householdId) {
        throw new Error("User not associated with a household");
      }

      const store = await prisma.store.create({
        data: {
          ...input,
          householdId: user.householdId,
        },
      });

      return store;
    }),

  update: protectedProcedure
    .input(updateStoreSchema)
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

      const store = await prisma.store.update({
        where: {
          id,
          householdId: user.householdId,
        },
        data,
      });

      return store;
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

      await prisma.store.delete({
        where: {
          id: input.id,
          householdId: user.householdId,
        },
      });

      return { success: true };
    }),
});
