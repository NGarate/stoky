import { z } from "zod";
import { createTRPCRouter, adminProcedure, householdProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import {
  storeSchema,
  updateStoreSchema,
  storeQuerySchema,
} from "@/lib/validations/store";

export const storeRouter = createTRPCRouter({
  list: householdProcedure
    .input(storeQuerySchema)
    .query(async ({ ctx, input }) => {
      const stores = await prisma.store.findMany({
        where: {
          householdId: ctx.householdId,
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

  create: adminProcedure
    .input(storeSchema)
    .mutation(async ({ ctx, input }) => {
      const store = await prisma.store.create({
        data: {
          ...input,
          householdId: ctx.householdId,
        },
      });

      return store;
    }),

  update: adminProcedure
    .input(updateStoreSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const store = await prisma.store.update({
        where: {
          id,
          householdId: ctx.householdId,
        },
        data,
      });

      return store;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.store.delete({
        where: {
          id: input.id,
          householdId: ctx.householdId,
        },
      });

      return { success: true };
    }),
});
