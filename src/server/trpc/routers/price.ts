import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, householdProcedure, writeProcedure } from "../trpc";
import {
  priceRecordSchema,
  priceHistorySchema,
} from "@/lib/validations/price";
import { withUnitPrices } from "@/lib/prices/unitPrice";

/**
 * What things cost, and where — the price intelligence half of the product.
 *
 * A `PriceRecord` is a *sighting*, not a current price: one product, one store,
 * one moment. Nothing is ever updated, so the history is the data and every
 * query here is an aggregation over it.
 *
 * **Two things write these**, and only one of them is here. This router's
 * `recordPrice` is the manual path; the other two are `inventory.addStock`
 * when a purchase carries a price, and the receipt pipeline when a scanned
 * receipt is applied. All three must verify that the store belongs to the
 * caller's household — the one that did not was SEC-1.
 *
 * **`price` is a total, not a unit price**: what was paid for `quantity`
 * units. Every read below therefore returns `unitPrice` beside it, computed
 * once here (`src/lib/prices/unitPrice.ts`), and leaves out a row with no
 * usable quantity — so no screen ranks a six-pack against a single carton by
 * what the whole pack cost.
 */
export const priceRouter = createTRPCRouter({
  /**
   * Records what something cost at a shop, by hand.
   *
   * Verifies both the product and the store against the caller's household
   * before writing, which `inventory.addStock` did not do and should have.
   */
  recordPrice: writeProcedure
    .input(priceRecordSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify product belongs to household
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

      // Verify store belongs to household
      const store = await ctx.db.store.findFirst({
        where: {
          id: input.storeId,
          householdId: ctx.householdId,
        },
      });

      if (!store) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Store not found",
        });
      }

      const priceRecord = await ctx.db.priceRecord.create({
        data: {
          ...input,
        },
      });

      return priceRecord;
    }),

  /** One product's sightings over time, for the chart. */
  getHistory: householdProcedure
    .input(priceHistorySchema)
    .query(async ({ ctx, input }) => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);

      const history = await ctx.db.priceRecord.findMany({
        where: {
          productId: input.productId,
          ...(input.storeId && { storeId: input.storeId }),
          recordedAt: {
            gte: startDate,
          },
          quantity: { gt: 0 },
          product: {
            householdId: ctx.householdId,
          },
        },
        include: {
          store: true,
        },
        orderBy: {
          recordedAt: "asc",
        },
      });

      return withUnitPrices(history);
    }),

  /** The most recent sighting per store for a product — where it is cheapest now. */
  getLatestPrices: householdProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Get latest price per store for the product
      const latestPrices = await ctx.db.priceRecord.findMany({
        where: {
          productId: input.productId,
          // Before the per-store pick, so a store's latest *usable* sighting
          // is the one reported rather than a row that cannot be compared.
          quantity: { gt: 0 },
          product: {
            householdId: ctx.householdId,
          },
        },
        include: {
          store: true,
        },
        orderBy: {
          recordedAt: "desc",
        },
      });

      // Group by store and take the first (latest) for each
      const pricesByStore = new Map<string, (typeof latestPrices)[number]>();
      for (const price of latestPrices) {
        if (!pricesByStore.has(price.storeId)) {
          pricesByStore.set(price.storeId, price);
        }
      }

      return withUnitPrices(Array.from(pricesByStore.values()));
    }),

  /**
   * Whether a product is getting dearer, over `days` (90 by default).
   *
   * Scoped by the product's household rather than by the record's, because a
   * `PriceRecord` has no `householdId` of its own — it reaches one through the
   * product. Worth knowing before writing a query against this table: filtering
   * on the record alone would cross households.
   */
  /** Every sighting for a product, across every store. */
  getProductPrices: householdProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const products = await ctx.db.product.findMany({
        where: {
          householdId: ctx.householdId,
          ...(input.search && {
            name: {
              contains: input.search,
              mode: "insensitive",
            },
          }),
        },
        include: {
          priceRecords: {
            where: { quantity: { gt: 0 } },
            include: {
              store: true,
            },
            orderBy: {
              recordedAt: "desc",
            },
            take: 1,
          },
        },
        take: input.limit,
      });

      return products.map((product) => ({
        ...product,
        priceRecords: withUnitPrices(product.priceRecords),
      }));
    }),
});
