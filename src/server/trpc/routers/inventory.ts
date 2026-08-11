import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, householdProcedure, writeProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import { stockEntrySchema } from "@/lib/validations/inventory";
import type { StockOperation } from "@prisma/client";

export const inventoryRouter = createTRPCRouter({
  getStockOverview: householdProcedure
    .input(
      z.object({
        locationId: z.string().optional(),
        category: z.string().optional(),
        lowStock: z.boolean().optional(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = {
        householdId: ctx.householdId,
        ...(input.category && { category: input.category }),
      };

      const products = await prisma.product.findMany({
        where,
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { name: "asc" },
        include: {
          stockEntries: {
            where: input.locationId
              ? { locationId: input.locationId }
              : undefined,
            include: {
              location: true,
            },
          },
        },
      });

      let nextCursor: typeof input.cursor = undefined;
      if (products.length > input.limit) {
        const nextItem = products.pop();
        if (nextItem) {
          nextCursor = nextItem.id;
        }
      }

      const stockOverview = products
        .map((product) => {
          const totalStock = product.stockEntries.reduce(
            (sum, entry) => sum + entry.quantity,
            0
          );

          const stockByLocation = product.stockEntries.reduce(
            (acc, entry) => {
              if (entry.location) {
                acc[entry.location.id] = {
                  locationName: entry.location.name,
                  quantity:
                    (acc[entry.location.id]?.quantity || 0) + entry.quantity,
                };
              }
              return acc;
            },
            {} as Record<
              string,
              { locationName: string; quantity: number }
            >
          );

          const isLowStock =
            product.minStock !== null && totalStock < product.minStock;

          return {
            ...product,
            totalStock,
            stockByLocation,
            isLowStock,
          };
        })
        .filter((product) => {
          if (!input.lowStock) return true;
          return product.isLowStock && product.minStock !== null;
        });

      return {
        products: stockOverview,
        nextCursor,
      };
    }),

  addStock: writeProcedure
    .input(
      stockEntrySchema.extend({
        price: z.number().optional(),
        storeId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify product exists and belongs to household
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

      // Verify location if provided
      if (input.locationId) {
        const location = await prisma.storageLocation.findFirst({
          where: {
            id: input.locationId,
            householdId: ctx.householdId,
          },
        });

        if (!location) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Location not found",
          });
        }
      }

      const stockEntry = await prisma.stockEntry.create({
        data: {
          productId: input.productId,
          quantity: Math.abs(input.quantity),
          unit: input.unit,
          expirationDate: input.expirationDate,
          locationId: input.locationId,
          operationType: "PURCHASE" as StockOperation,
          note: input.note,
          createdBy: userId,
        },
        include: {
          product: true,
          location: true,
        },
      });

      // Create price record if price and storeId are provided
      if (input.price && input.price > 0 && input.storeId) {
        await prisma.priceRecord.create({
          data: {
            productId: input.productId,
            storeId: input.storeId,
            price: input.price,
            unit: input.unit,
            quantity: Math.abs(input.quantity),
            currency: "EUR",
          },
        });
      }

      return stockEntry;
    }),

  consumeStock: householdProcedure
    .input(
      stockEntrySchema.extend({
        consumeFromLocationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify product exists and belongs to household
      const product = await prisma.product.findFirst({
        where: {
          id: input.productId,
          householdId: ctx.householdId,
        },
        include: {
          stockEntries: {
            // Every entry, not just the positive ones. Consumption is recorded
            // as a *separate* row with a negative quantity, so `gt: 0` here
            // measured gross purchases and ignored everything ever used: six
            // litres bought and four drunk read as six available, and the
            // server would accept a consumption of five and drive stock to
            // minus two (ISSUES.md INV-1).
            where: input.consumeFromLocationId
              ? { locationId: input.consumeFromLocationId }
              : undefined,
            orderBy: { expirationDate: "asc" },
          },
        },
      });

      if (!product) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      }

      const totalAvailable = product.stockEntries.reduce(
        (sum, entry) => sum + entry.quantity,
        0
      );

      if (Math.abs(input.quantity) > totalAvailable) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Not enough stock available",
        });
      }

      // Create consumption entry (negative quantity)
      const stockEntry = await prisma.stockEntry.create({
        data: {
          productId: input.productId,
          quantity: -Math.abs(input.quantity),
          unit: input.unit,
          locationId: input.consumeFromLocationId || input.locationId,
          operationType: "CONSUME" as StockOperation,
          note: input.note,
          createdBy: userId,
        },
        include: {
          product: true,
          location: true,
        },
      });

      return stockEntry;
    }),

  adjustStock: writeProcedure
    .input(
      stockEntrySchema.extend({
        reason: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify product exists and belongs to household
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

      const stockEntry = await prisma.stockEntry.create({
        data: {
          productId: input.productId,
          quantity: input.quantity,
          unit: input.unit,
          locationId: input.locationId,
          operationType: "ADJUST" as StockOperation,
          note: input.reason,
          createdBy: userId,
        },
        include: {
          product: true,
          location: true,
        },
      });

      return stockEntry;
    }),

  transferStock: writeProcedure
    .input(
      z.object({
        productId: z.string(),
        quantity: z.number().positive(),
        unit: z.string(),
        fromLocationId: z.string(),
        toLocationId: z.string(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (input.fromLocationId === input.toLocationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot transfer to the same location",
        });
      }

      // Verify product exists
      const product = await prisma.product.findFirst({
        where: {
          id: input.productId,
          householdId: ctx.householdId,
        },
        include: {
          stockEntries: {
            // Same defect as `consumeStock`, at a third location ISSUES.md
            // INV-1 does not name: `gt: 0` counted what arrived at the source
            // and not what left it, so a shelf with six in and four out
            // offered six to move.
            where: { locationId: input.fromLocationId },
          },
        },
      });

      if (!product) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      }

      const availableInSource = product.stockEntries.reduce(
        (sum, entry) => sum + entry.quantity,
        0
      );

      if (input.quantity > availableInSource) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Not enough stock in source location",
        });
      }

      // Verify locations exist
      const locations = await prisma.storageLocation.findMany({
        where: {
          id: { in: [input.fromLocationId, input.toLocationId] },
          householdId: ctx.householdId,
        },
      });

      if (locations.length !== 2) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or more locations not found",
        });
      }

      // Create transfer entries
      const [fromEntry, toEntry] = await prisma.$transaction([
        prisma.stockEntry.create({
          data: {
            productId: input.productId,
            quantity: -input.quantity,
            unit: input.unit,
            locationId: input.fromLocationId,
            operationType: "TRANSFER" as StockOperation,
            note: input.note || `Transfer to ${locations.find((l) => l.id === input.toLocationId)?.name}`,
            createdBy: userId,
          },
          include: {
            product: true,
            location: true,
          },
        }),
        prisma.stockEntry.create({
          data: {
            productId: input.productId,
            quantity: input.quantity,
            unit: input.unit,
            locationId: input.toLocationId,
            operationType: "TRANSFER" as StockOperation,
            note: input.note || `Transfer from ${locations.find((l) => l.id === input.fromLocationId)?.name}`,
            createdBy: userId,
          },
          include: {
            product: true,
            location: true,
          },
        }),
      ]);

      return { fromEntry, toEntry };
    }),

  getStockHistory: householdProcedure
    .input(
      z.object({
        productId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify product exists and belongs to household
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

      const entries = await prisma.stockEntry.findMany({
        where: {
          productId: input.productId,
        },
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { createdAt: "desc" },
        include: {
          location: true,
        },
      });

      let nextCursor: typeof input.cursor = undefined;
      if (entries.length > input.limit) {
        const nextItem = entries.pop();
        if (nextItem) {
          nextCursor = nextItem.id;
        }
      }

      return {
        entries,
        nextCursor,
      };
    }),

  // F19: Expiration Tracking
  getExpiringItems: householdProcedure
    .input(
      z.object({
        days: z.number().default(7),
        locationId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const expiryThreshold = new Date();
      expiryThreshold.setDate(expiryThreshold.getDate() + input.days);

      const expiringItems = await prisma.stockEntry.findMany({
        where: {
          product: {
            householdId: ctx.householdId,
          },
          expirationDate: {
            lte: expiryThreshold,
            gte: new Date(),
          },
          quantity: { gt: 0 },
          ...(input.locationId && { locationId: input.locationId }),
        },
        orderBy: {
          expirationDate: "asc",
        },
        include: {
          product: true,
          location: true,
        },
      });

      return expiringItems
        .filter((item): item is typeof item & { expirationDate: Date } => item.expirationDate !== null)
        .map((item) => {
          const daysUntilExpiry = Math.ceil(
            (item.expirationDate.getTime() - new Date().getTime()) /
              (1000 * 60 * 60 * 24)
          );

          return {
            ...item,
            daysUntilExpiry,
            isExpiringSoon: daysUntilExpiry <= 3,
          };
        });
    }),

  getExpiredItems: householdProcedure
    .input(
      z.object({
        locationId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const expiredItems = await prisma.stockEntry.findMany({
        where: {
          product: {
            householdId: ctx.householdId,
          },
          expirationDate: {
            lt: new Date(),
          },
          quantity: { gt: 0 },
          ...(input.locationId && { locationId: input.locationId }),
        },
        orderBy: {
          expirationDate: "desc",
        },
        include: {
          product: true,
          location: true,
        },
      });

      return expiredItems
        .filter((item): item is typeof item & { expirationDate: Date } =>
          item.expirationDate !== null
        )
        .map((item) => ({
          ...item,
          daysExpired: Math.ceil(
            (new Date().getTime() - item.expirationDate.getTime()) /
              (1000 * 60 * 60 * 24)
          ),
        }));
    }),
});
