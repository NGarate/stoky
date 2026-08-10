import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, householdProcedure, writeProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import {
  priceRecordSchema,
  priceHistorySchema,
} from "@/lib/validations/price";

export const priceRouter = createTRPCRouter({
  recordPrice: writeProcedure
    .input(priceRecordSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify product belongs to household
      const product = await prisma.product.findFirst({
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
      const store = await prisma.store.findFirst({
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

      const priceRecord = await prisma.priceRecord.create({
        data: {
          ...input,
        },
      });

      return priceRecord;
    }),

  getHistory: householdProcedure
    .input(priceHistorySchema)
    .query(async ({ ctx, input }) => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);

      const history = await prisma.priceRecord.findMany({
        where: {
          productId: input.productId,
          ...(input.storeId && { storeId: input.storeId }),
          recordedAt: {
            gte: startDate,
          },
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

      return history;
    }),

  getLatestPrices: householdProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Get latest price per store for the product
      const latestPrices = await prisma.priceRecord.findMany({
        where: {
          productId: input.productId,
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
      const pricesByStore = new Map();
      for (const price of latestPrices) {
        if (!pricesByStore.has(price.storeId)) {
          pricesByStore.set(price.storeId, price);
        }
      }

      return Array.from(pricesByStore.values());
    }),

  getPriceTrends: householdProcedure
    .input(
      z.object({
        productId: z.string(),
        days: z.number().default(90),
      })
    )
    .query(async ({ ctx, input }) => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);

      const prices = await prisma.priceRecord.findMany({
        where: {
          productId: input.productId,
          recordedAt: {
            gte: startDate,
          },
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

      // Group by date and calculate average price per day
      const trends = new Map();
      for (const price of prices) {
        const date = price.recordedAt.toISOString().split("T")[0];
        if (!trends.has(date)) {
          trends.set(date, { date, prices: [] });
        }
        trends.get(date).prices.push(price.price);
      }

      return Array.from(trends.values()).map((day: { date: string; prices: number[] }) => ({
        date: day.date,
        averagePrice: day.prices.reduce((a: number, b: number) => a + b, 0) / day.prices.length,
        minPrice: Math.min(...day.prices),
        maxPrice: Math.max(...day.prices),
      }));
    }),

  getProductPrices: householdProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const products = await prisma.product.findMany({
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

      return products;
    }),
});
