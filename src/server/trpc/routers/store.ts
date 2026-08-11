import { z } from "zod";
import { createTRPCRouter, adminProcedure, householdProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import {
  storeSchema,
  updateStoreSchema,
  storeQuerySchema,
} from "@/lib/validations/store";

/**
 * The shops this household buys from.
 *
 * They exist for prices. A `PriceRecord` without a store is meaningless —
 * "milk cost €1.19" is only useful next to where — which is why a receipt with
 * no store attached records no prices at all, and why the receipts screen says
 * so rather than failing quietly.
 *
 * `adminProcedure` for the writes: like locations, this is household
 * configuration rather than household data.
 */
export const storeRouter = createTRPCRouter({
  /** Every store, for the pickers on the receipt and add-stock screens. */
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

  /** Adds a shop. */
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

  /** Renames a shop or changes its address. */
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

  /**
   * Removes a shop.
   *
   * Note that this does *not* check for price records first, so a store with
   * price history behind it fails on the foreign key rather than with a
   * sentence — the same defect as PROD-1, and unlike `location.delete` next
   * door, which checks and says which.
   */
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
