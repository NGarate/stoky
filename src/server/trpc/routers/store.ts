import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_ID_LENGTH } from "@/lib/validations/bounds";
import { createTRPCRouter, adminProcedure, householdProcedure } from "../trpc";
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
      const stores = await ctx.db.store.findMany({
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
  create: adminProcedure.input(storeSchema).mutation(async ({ ctx, input }) => {
    const store = await ctx.db.store.create({
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

      const store = await ctx.db.store.update({
        where: {
          id,
          householdId: ctx.householdId,
        },
        data,
      });

      return store;
    }),

  /**
   * Removes a shop, if no price or receipt points at it.
   *
   * The same rule and the same reason as `product.delete`: nothing declares
   * `onDelete`, so the database refuses rather than cascading, and cascading
   * would be wrong anyway — a price sighting with nowhere attached says
   * nothing at all, so deleting a shop would silently gut the price history
   * rather than tidy it.
   *
   * It used to leave that to the foreign key, which reported it as "That refers
   * to something that does not exist" (ISSUES.md PROD-1's second instance).
   *
   * It also used to rely on `where: { id, householdId }` to scope the delete,
   * which does refuse another household's store. The row is read first now so
   * the reference counting and its CONFLICT can speak before the foreign key
   * gets a say — but "not yours" and "not there" are still the same
   * NOT_FOUND, on purpose: confirming that an id exists is information, the
   * rule every router here follows.
   */
  delete: adminProcedure
    .input(z.object({ id: z.string().max(MAX_ID_LENGTH) }))
    .mutation(async ({ ctx, input }) => {
      const store = await ctx.db.store.findFirst({
        where: {
          id: input.id,
          householdId: ctx.householdId,
        },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found",
        });
      }

      const [priceRecords, receipts] = await Promise.all([
        ctx.db.priceRecord.count({ where: { storeId: input.id } }),
        ctx.db.receipt.count({ where: { storeId: input.id } }),
      ]);

      const blocking = [
        priceRecords > 0 ? `${priceRecords} price records` : null,
        receipts > 0 ? `${receipts} receipts` : null,
      ].filter((part): part is string => part !== null);

      if (blocking.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `This shop still has ${blocking.join(" and ")}. Those would lose their meaning without it.`,
        });
      }

      await ctx.db.store.delete({ where: { id: input.id } });

      return { success: true };
    }),
});
