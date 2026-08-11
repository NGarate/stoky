import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, householdProcedure, writeProcedure } from "../trpc";
import { stockEntrySchema } from "@/lib/validations/inventory";
import { daysBetween, remainingByBatch } from "@/lib/inventory/batches";
import { replayable } from "@/lib/validations/idempotency";
import { withReplay } from "../replay";
import type { Prisma, StockOperation } from "@prisma/client";

/** Half-open bounds on an expiry date, in the shape Prisma words them. */
interface ExpiryWindow {
  gte?: Date;
  lte?: Date;
  lt?: Date;
}

/**
 * Dated batches with something still in them, whose date falls in `window`.
 *
 * Both expiry views used to ask the database for stock entries with
 * `quantity: { gt: 0 }` and report each row's own quantity. Consumption is a
 * separate negative entry with no expiry date, so it was filtered out and
 * never subtracted: the figure returned was the size of the original purchase,
 * and a batch drunk weeks ago still appeared as about to spoil (ISSUES.md
 * INV-1).
 *
 * The query is therefore per *product* rather than per entry — a batch's
 * remaining quantity cannot be known without the rest of that product's
 * ledger — and `remainingByBatch` states the drawdown rule.
 */
async function datedBatchesInWindow(
  db: Prisma.TransactionClient,
  householdId: string,
  locationId: string | undefined,
  window: ExpiryWindow,
) {
  const products = await db.product.findMany({
    where: {
      householdId,
      stockEntries: { some: { expirationDate: { not: null } } },
    },
    include: {
      stockEntries: {
        // Consumption recorded against a location draws down that location's
        // batches. Scoping here rather than after the fact keeps stock used in
        // the kitchen from erasing a batch in the garage.
        where: locationId ? { locationId } : undefined,
        include: { location: true },
      },
    },
  });

  const batches = [];

  for (const { stockEntries, ...product } of products) {
    const remaining = remainingByBatch(stockEntries);

    for (const entry of stockEntries) {
      const expirationDate = entry.expirationDate;
      if (expirationDate === null) continue;

      const left = remaining.get(entry.id) ?? 0;
      if (left <= 0) continue;

      if (window.gte && expirationDate < window.gte) continue;
      if (window.lte && expirationDate > window.lte) continue;
      if (window.lt && expirationDate >= window.lt) continue;

      batches.push({
        ...entry,
        // What is left of this batch, not what was bought. The field keeps its
        // name because that is what every caller already means by it.
        quantity: left,
        expirationDate,
        product,
      });
    }
  }

  return batches.sort(
    (a, b) => a.expirationDate.getTime() - b.expirationDate.getTime(),
  );
}

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

      const products = await ctx.db.product.findMany({
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
      stockEntrySchema
        .extend({
          price: z.number().optional(),
          storeId: z.string().optional(),
        })
        .merge(replayable)
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify product exists and belongs to household
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

      // Verify location if provided
      if (input.locationId) {
        const location = await ctx.db.storageLocation.findFirst({
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

      // Verify the store the same way, and before anything is written.
      //
      // The price record below took `storeId` straight from input while
      // `price.recordPrice` verified the identical write, so any MEMBER could
      // attach a price record to another household's Store — a cross-household
      // write with no interface in front of it. The product and the location
      // above were already checked; the store was the one that was not.
      if (input.storeId) {
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
      }

      /**
       * The entry and its price, or neither.
       *
       * A purchase is one event told in two rows. Written separately, a failure
       * between them leaves stock recorded at no price — which is invisible on
       * the inventory screen and silently wrong on the price history, where the
       * whole point is knowing what things cost.
       *
       * The bounds are explicit rather than Prisma's 2s/5s defaults. Phase 4
       * drains a queued shop through here on reconnect, and a default that was
       * chosen for one interactive request is the wrong ceiling for a burst.
       */
      return withReplay(ctx, {
        key: input.idempotencyKey,
        composedByUserId: input.composedByUserId,
        procedure: "inventory.addStock",
        input,
        apply: async (tx) => {
          const entry = await tx.stockEntry.create({
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

          if (input.price && input.price > 0 && input.storeId) {
            await tx.priceRecord.create({
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

          return entry;
        },
        ids: (entry) => [entry.id],
        reread: async (db, ids) => {
          const entry = await db.stockEntry.findUnique({
            where: { id: ids[0] ?? "" },
            include: { product: true, location: true },
          });
          if (!entry) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Stock entry not found",
            });
          }
          return entry;
        },
      });
    }),

  consumeStock: householdProcedure
    .input(
      stockEntrySchema
        .extend({
          consumeFromLocationId: z.string().optional(),
        })
        .merge(replayable)
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      return withReplay(ctx, {
        key: input.idempotencyKey,
        composedByUserId: input.composedByUserId,
        procedure: "inventory.consumeStock",
        input,
        apply: async (tx) => {
          /**
           * Hold the product for the length of the transaction.
           *
           * The guard and the write being in one transaction is not enough on
           * its own: under READ COMMITTED two calls read the same figure, both
           * pass, and both write. Idempotency does not help — they carry
           * *different* keys, because they are two real intentions. That is
           * ISSUES.md INV-2, and a queue draining as one batch is exactly how
           * sequential taps by one person become concurrent calls.
           *
           * Locking the product row rather than the entries means the lock
           * exists whether or not there are any entries yet, and every
           * consumption of the same product serialises behind it.
           *
           * A tagged template, so the id is a bound parameter and never
           * concatenated into SQL (CLAUDE.md, Security Constraints).
           */
          await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;

          const product = await tx.product.findFirst({
            where: {
              id: input.productId,
              householdId: ctx.householdId,
            },
            include: {
              stockEntries: {
                // Every entry, not just the positive ones. Consumption is
                // recorded as a *separate* row with a negative quantity, so
                // `gt: 0` here measured gross purchases and ignored everything
                // ever used: six litres bought and four drunk read as six
                // available, and the server would accept a consumption of five
                // and drive stock to minus two (ISSUES.md INV-1).
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

          return tx.stockEntry.create({
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
        },
        ids: (entry) => [entry.id],
        reread: async (db, ids) => {
          const entry = await db.stockEntry.findUnique({
            where: { id: ids[0] ?? "" },
            include: { product: true, location: true },
          });
          if (!entry) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Stock entry not found",
            });
          }
          return entry;
        },
      });
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

      const stockEntry = await ctx.db.stockEntry.create({
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

      /**
       * Guard and write in one transaction, with the product held.
       *
       * The guard used to sit outside the `$transaction`, which covered only
       * the two writes — so two transfers of the same stock could both read
       * the same figure, both pass, and both write, emptying a shelf twice
       * (ISSUES.md INV-2). `consumeStock`'s half was closed in Phase 4; this
       * is the other, and it is the same lock on the same row for the same
       * reason.
       *
       * Locking the product rather than its entries means every movement of
       * that product serialises, whichever location it is going between —
       * which is what a transfer needs, since it touches two.
       */
      return ctx.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;

          const product = await tx.product.findFirst({
            where: {
              id: input.productId,
              householdId: ctx.householdId,
            },
            include: {
              stockEntries: {
                // Every entry, not only the positive ones: `gt: 0` counted
                // what arrived at the source and not what left it, so a shelf
                // with six in and four out offered six to move (INV-1).
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
            0,
          );

          if (input.quantity > availableInSource) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Not enough stock in source location",
            });
          }

          const locations = await tx.storageLocation.findMany({
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

          const fromEntry = await tx.stockEntry.create({
            data: {
              productId: input.productId,
              quantity: -input.quantity,
              unit: input.unit,
              locationId: input.fromLocationId,
              operationType: "TRANSFER" as StockOperation,
              note:
                input.note ||
                `Transfer to ${locations.find((l) => l.id === input.toLocationId)?.name}`,
              createdBy: userId,
            },
            include: { product: true, location: true },
          });

          const toEntry = await tx.stockEntry.create({
            data: {
              productId: input.productId,
              quantity: input.quantity,
              unit: input.unit,
              locationId: input.toLocationId,
              operationType: "TRANSFER" as StockOperation,
              note:
                input.note ||
                `Transfer from ${locations.find((l) => l.id === input.fromLocationId)?.name}`,
              createdBy: userId,
            },
            include: { product: true, location: true },
          });

          return { fromEntry, toEntry };
        },
        { maxWait: 5_000, timeout: 10_000 },
      );
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

      const entries = await ctx.db.stockEntry.findMany({
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
      const now = new Date();
      const expiryThreshold = new Date(now);
      expiryThreshold.setDate(expiryThreshold.getDate() + input.days);

      const batches = await datedBatchesInWindow(
        ctx.db,
        ctx.householdId,
        input.locationId,
        { gte: now, lte: expiryThreshold },
      );

      return batches.map((batch) => {
        const daysUntilExpiry = daysBetween(now, batch.expirationDate);

        return {
          ...batch,
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
      const now = new Date();

      const batches = await datedBatchesInWindow(
        ctx.db,
        ctx.householdId,
        input.locationId,
        { lt: now },
      );

      return batches
        .map((batch) => ({
          ...batch,
          // One measurement, negated — not a second one in the other
          // direction. Rounding elapsed time *up*, which is what this did
          // before, reported a carton four days and one second gone as five
          // days gone. Days remaining and days elapsed are the same distance.
          daysExpired: -daysBetween(now, batch.expirationDate),
        }))
        // Newest first, matching the previous `expirationDate: "desc"`.
        .reverse();
    }),
});
