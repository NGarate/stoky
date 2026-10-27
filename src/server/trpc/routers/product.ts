import { unitConversion, canonicalProduct } from "@/lib/inventory/units";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_ID_LENGTH, MAX_NAME_LENGTH } from "@/lib/validations/bounds";
import {
  adminProcedure,
  createTRPCRouter,
  householdProcedure,
  NotHouseholdData,
  writeProcedure,
} from "../trpc";
import type { Prisma } from "@/generated/prisma/client";
import {
  openFoodFacts,
  type OpenFoodFactsProduct,
} from "@/server/services/openFoodFacts";
import { withReplay } from "@/server/trpc/replay";
import { enforceRateLimit } from "@/server/trpc/throttle";
import { productLookupRateLimit } from "@/lib/rate-limit";
import { netStock } from "@/lib/inventory/batches";
import { stockTotals } from "@/lib/stock/totals";
import {
  productSchema,
  updateProductSchema,
  productSearchSchema,
  productByBarcodeSchema,
  productPaginationSchema,
  resolveScanSchema,
} from "@/lib/validations/product";

/**
 * Text from Open Food Facts, cut to the length the edit form's schema takes.
 *
 * The bounds in `src/lib/validations/bounds.ts` hold for what a caller sends.
 * These three columns are not sent by a caller: they are whatever the OFF
 * entry says, and anyone can edit an OFF entry. Stored past the bound, a long
 * brand list would make a product the detail form cannot save: the form sends
 * the name, brand and category back on every edit, and the edit schema would
 * refuse them.
 *
 * Cut in UTF-16 units, which is what `.max()` counts, without leaving half a
 * surrogate pair behind.
 */
function offText(value: string): string {
  if (value.length <= MAX_NAME_LENGTH) return value;
  const cut = value.slice(0, MAX_NAME_LENGTH);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * The columns an Open Food Facts hit becomes on a new `Product`.
 *
 * Extracted so `scanBarcode` (connected) and `resolveScan` (drained from the
 * offline queue) map an OFF product to a row the same way — the two producing
 * different products from the same barcode is the drift this closes.
 */
function productFromOff(
  offProduct: OpenFoodFactsProduct,
  barcode: string,
  householdId: string,
): Prisma.ProductCreateInput {
  const category = offProduct.categories
    ? offProduct.categories.split(",").map((c) => c.trim())[0]
    : null;

  return {
    name: offText(offProduct.product_name || `Product ${barcode}`),
    barcode,
    brand: offProduct.brands ? offText(offProduct.brands) : null,
    category: category === null ? null : offText(category),
    imageUrl: offProduct.image_url || offProduct.image_front_url || null,
    defaultUnit: openFoodFacts.extractUnit(offProduct.quantity),
    openFoodFactsData: offProduct,
    household: { connect: { id: householdId } },
  };
}

/**
 * The meter on a lookup that is about to leave for Open Food Facts — handed to
 * `getProductByBarcode`, which asks it only after the shared cache has missed.
 * The household's own products never get that far either, so rescanning what a
 * household already has, or what anyone on the instance has already looked
 * up, costs nothing.
 *
 * Over budget it throws TOO_MANY_REQUESTS with the wait, which the scan page
 * turns into the manual form and the write queue into the review question
 * that opens the same form (`classify.ts`). With
 * Valkey unreachable the request is **not sent** and the lookup answers null,
 * like an Open Food Facts outage: closed for what the limit protects, because
 * no uncounted request leaves; not a refusal, because the person lands on the
 * form an unknown code would have given them anyway.
 */
function meterLookup(userId: string): () => Promise<boolean> {
  return () =>
    enforceRateLimit(
      productLookupRateLimit(),
      userId,
      "Too many new barcodes looked up. Enter this product by hand, or try again in a little while.",
      { whenUnavailable: "skip" },
    );
}

/** Enough distinct values for any household's forms; the field filters them. */
const MAX_SUGGESTIONS = 200;

/**
 * The catalogue: what this household *can* have, as distinct from what it has.
 *
 * A `Product` is the thing on the label; a `StockEntry` is a tin of it in the
 * cupboard. They are separate because the same tin arrives repeatedly and the
 * label does not change, and because prices belong to the product rather than
 * to any one purchase.
 *
 * **Products are per household**, which is why `barcode` is unique against
 * `householdId` rather than on its own: two households scanning the same tin
 * each get their own row, with their own minimum and their own name for it.
 * Sharing them would mean one household's rename showing up in another's
 * kitchen.
 */
export const productRouter = createTRPCRouter({
  /** The catalogue, paginated, newest first. */
  list: householdProcedure
    .input(productPaginationSchema)
    .query(async ({ ctx, input }) => {
      const { cursor, limit, search } = input;

      const where = {
        householdId: ctx.householdId,
        ...(search && {
          name: {
            contains: search,
            mode: "insensitive" as const,
          },
        }),
      };

      const products = await ctx.db.product.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { name: "asc" },
        include: {
          _count: {
            select: {
              stockEntries: true,
            },
          },
        },
      });

      let nextCursor: typeof cursor = undefined;
      if (products.length > limit) {
        const nextItem = products.pop();
        if (nextItem) {
          nextCursor = nextItem.id;
        }
      }

      const stockOf = await stockTotals(
        ctx.db,
        products.map((product) => product.id),
      );
      const productsWithStock = products.map((product) => ({
        ...product,
        totalStock: stockOf.get(product.id) ?? 0,
      }));

      return {
        products: productsWithStock,
        nextCursor,
      };
    }),

  /** One product with its stock entries, for the detail screen. */
  getById: householdProcedure
    .input(z.object({ id: z.string().max(MAX_ID_LENGTH) }))
    .query(async ({ ctx, input }) => {
      const product = await ctx.db.product.findFirst({
        where: {
          id: input.id,
          householdId: ctx.householdId,
        },
        include: {
          stockEntries: {
            orderBy: { createdAt: "desc" },
            include: {
              location: true,
            },
          },
          priceRecords: {
            orderBy: { recordedAt: "desc" },
            take: 5,
            include: {
              store: true,
            },
          },
        },
      });

      if (!product) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      }

      return {
        ...product,
        totalStock: netStock(product.stockEntries),
      };
    }),

  /**
   * One product by its barcode, or null — a lookup, not a scan.
   *
   * `scanBarcode` below is the one that reaches Open Food Facts and creates a
   * row. This only ever answers about what is already here, which is what the
   * scanner needs before deciding whether to ask anybody anything.
   */
  getByBarcode: householdProcedure
    .input(productByBarcodeSchema)
    .query(async ({ ctx, input }) => {
      const product = await ctx.db.product.findUnique({
        where: {
          barcode_householdId: {
            barcode: input.barcode,
            householdId: ctx.householdId,
          },
        },
      });

      if (!product) {
        return null;
      }

      const stockOf = await stockTotals(ctx.db, [product.id]);
      return {
        ...product,
        totalStock: stockOf.get(product.id) ?? 0,
      };
    }),

  /**
   * How many products the household actually has.
   *
   * The Panel's catalogue card used to show the length of `list`'s first page,
   * which is "at least this many" wearing the clothes of a count. A number that
   * is a door people open has to be the real one (Phase 8 item 2).
   */
  count: householdProcedure.query(({ ctx }) => {
    return ctx.db.product.count({
      where: { householdId: ctx.householdId },
    });
  }),

  /**
   * The brands, categories and units this household has already used, most
   * used first, for the product forms to suggest.
   *
   * Without them each form was a blank field, and the same brand ended up
   * stored three ways — which the products list then shows as three brands.
   * Most used first because the field shows only the first few until the
   * person types, and the common answer should be among them.
   */
  suggestions: householdProcedure.query(async ({ ctx }) => {
    const where = { householdId: ctx.householdId };
    const [brands, categories, units] = await Promise.all([
      ctx.db.product.groupBy({
        by: ["brand"],
        where: { ...where, brand: { not: null } },
        orderBy: [{ _count: { brand: "desc" } }, { brand: "asc" }],
        take: MAX_SUGGESTIONS,
      }),
      ctx.db.product.groupBy({
        by: ["category"],
        where: { ...where, category: { not: null } },
        orderBy: [{ _count: { category: "desc" } }, { category: "asc" }],
        take: MAX_SUGGESTIONS,
      }),
      ctx.db.product.groupBy({
        by: ["defaultUnit"],
        where,
        orderBy: [{ _count: { defaultUnit: "desc" } }, { defaultUnit: "asc" }],
        take: MAX_SUGGESTIONS,
      }),
    ]);

    return {
      brands: brands.flatMap((row) => (row.brand ? [row.brand] : [])),
      categories: categories.flatMap((row) =>
        row.category ? [row.category] : [],
      ),
      units: units.map((row) => row.defaultUnit),
    };
  }),

  /** Adds a product by hand, for the things that have no barcode. */
  create: writeProcedure
    .input(productSchema.transform(canonicalProduct))
    .mutation(async ({ ctx, input }) => {
      const product = await ctx.db.product.create({
        data: {
          ...input,
          householdId: ctx.householdId,
        },
      });

      return product;
    }),

  /** Edits a product. The name, the unit, and the minimum that drives "to buy". */
  update: writeProcedure
    .input(updateProductSchema.transform(canonicalProduct))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      return ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${id} AND "householdId" = ${ctx.householdId} FOR UPDATE`;
        const existingProduct = await tx.product.findFirst({
          where: { id, householdId: ctx.householdId },
        });
        if (!existingProduct) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Product not found",
          });
        }
        const target = data.defaultUnit;
        if (target && target !== existingProduct.defaultUnit) {
          const entries = await tx.stockEntry.findMany({
            where: { productId: id },
          });
          const prices = await tx.priceRecord.findMany({
            where: { productId: id },
          });
          const items = await tx.shoppingItem.findMany({
            where: { productId: id },
          });
          const rows = [...entries, ...prices, ...items];
          if (
            rows.some((row) => unitConversion(row.unit, target) === undefined)
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Unit conversion needs a known quantity per package",
            });
          }
          for (const row of entries) {
            await tx.stockEntry.update({
              where: { id: row.id },
              data: {
                quantity: row.quantity * unitConversion(row.unit, target)!,
                unit: target,
              },
            });
          }
          for (const row of prices) {
            await tx.priceRecord.update({
              where: { id: row.id },
              data: {
                quantity: row.quantity * unitConversion(row.unit, target)!,
                unit: target,
              },
            });
          }
          for (const row of items) {
            await tx.shoppingItem.update({
              where: { id: row.id },
              data: {
                quantity: row.quantity * unitConversion(row.unit, target)!,
                unit: target,
              },
            });
          }
          if (
            data.minStock === undefined &&
            existingProduct.minStock !== null
          ) {
            const factor = unitConversion(existingProduct.defaultUnit, target);
            if (factor === undefined) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Unit conversion needs a known quantity per package",
              });
            }
            data.minStock = existingProduct.minStock * factor;
          }
        }
        return tx.product.update({ where: { id }, data });
      });
    }),

  /**
   * Removes a product — **only one that has never been used.**
   *
   * There is no `deletedAt` column in the schema (the search query once
   * filtered on one that did not exist, which was CRITICAL-1), so this is a
   * real delete. No relation declares `onDelete`, which means Prisma's default
   * applies and the database *refuses* rather than cascading: a product with a
   * single stock entry, price record, receipt line or shopping item cannot go.
   *
   * That rule is deliberate — cascading would take the price history the price
   * screens exist to show — but it used to arrive as a foreign-key error
   * translated to "That refers to something that does not exist", a sentence
   * about the opposite of what happened: too many rows refer to *this* one, not
   * too few to that one. ISSUES.md PROD-1.
   *
   * So the references are counted first and the refusal names what is in the
   * way, which is the shape `location.delete` already had.
   *
   * `adminProcedure` since the owner's pass (Phase 8 item 5, D90): a hard
   * delete with no undo is the household's decision, not any member's.
   */
  delete: adminProcedure
    .input(z.object({ id: z.string().max(MAX_ID_LENGTH) }))
    .mutation(async ({ ctx, input }) => {
      const existingProduct = await ctx.db.product.findFirst({
        where: {
          id: input.id,
          householdId: ctx.householdId,
        },
      });

      if (!existingProduct) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      }

      // Counted rather than fetched: the answer is "is there any", and the
      // number is what makes the message useful.
      const [stockEntries, priceRecords, receiptItems, shoppingItems] =
        await Promise.all([
          ctx.db.stockEntry.count({ where: { productId: input.id } }),
          ctx.db.priceRecord.count({ where: { productId: input.id } }),
          ctx.db.receiptItem.count({ where: { matchedProductId: input.id } }),
          ctx.db.shoppingItem.count({ where: { productId: input.id } }),
        ]);

      const blocking = [
        stockEntries > 0 ? `${stockEntries} stock entries` : null,
        priceRecords > 0 ? `${priceRecords} price records` : null,
        receiptItems > 0 ? `${receiptItems} receipt lines` : null,
        shoppingItems > 0 ? `${shoppingItems} shopping items` : null,
      ].filter((part): part is string => part !== null);

      if (blocking.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `This product still has ${blocking.join(", ")}. Remove those first, or keep the product.`,
        });
      }

      await ctx.db.product.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  /**
   * Fuzzy name search, ranked by similarity.
   *
   * PostgreSQL's `pg_trgm`: `%` is the similarity operator and the GIN index on
   * `Product.name` is what makes it cheap. It matches misspellings and partial
   * words, which is the point — somebody typing "leche entra" on a phone in a
   * supermarket should still find the milk.
   *
   * Raw SQL because Prisma has no `similarity()`, and a tagged template so the
   * query is parameterised — the household id and the search term both come
   * from the caller.
   */
  searchByName: householdProcedure
    .input(productSearchSchema)
    .query(async ({ ctx, input }) => {
      // Use pg_trgm similarity search
      const products = await ctx.db.$queryRaw`
        SELECT 
          id, name, barcode, brand, category, "defaultUnit", "minStock",
          similarity(name, ${input.query}) as similarity
        FROM "Product"
        WHERE "householdId" = ${ctx.householdId}
          AND name % ${input.query}
        ORDER BY similarity(name, ${input.query}) DESC
        LIMIT ${input.limit}
      `;

      return products as Array<{
        id: string;
        name: string;
        barcode: string | null;
        brand: string | null;
        category: string | null;
        defaultUnit: string;
        minStock: number | null;
        similarity: number;
      }>;
    }),

  /**
   * Scanning a barcode, which is a lookup that may also create.
   *
   * Three outcomes, and the `source` field says which: `local` when the
   * household already has the product, `open_food_facts` when that service knew it and a
   * row was created from what it said, `not_found` when nobody knew it — and
   * that is not a failure, it is the scanner handing over to the manual
   * creation form.
   *
   * A mutation rather than a query because of the middle case: it writes. That
   * also makes it `writeProcedure`, so a KITCHEN account cannot scan, which
   * matches the capability matrix — a kitchen tablet looks and uses up.
   *
   * The Open Food Facts call is cached in Valkey for thirty days, and a
   * barcode it does not know for a day. A lookup that misses both is metered
   * per account (`meterLookup`); with the cache down none can be counted, so
   * none is sent and the person gets the manual form (DEBT-3).
   */
  scanBarcode: writeProcedure
    .input(productByBarcodeSchema)
    .mutation(async ({ ctx, input }) => {
      // First, check if product already exists in local database
      const existingProduct = await ctx.db.product.findUnique({
        where: {
          barcode_householdId: {
            barcode: input.barcode,
            householdId: ctx.householdId,
          },
        },
      });

      if (existingProduct) {
        const stockOf = await stockTotals(ctx.db, [existingProduct.id]);
        return {
          product: {
            ...existingProduct,
            totalStock: stockOf.get(existingProduct.id) ?? 0,
          },
          source: "local" as const,
        };
      }

      // Fetch from Open Food Facts
      const offProduct = await openFoodFacts.getProductByBarcode(
        input.barcode,
        meterLookup(ctx.session.user.id),
      );

      if (!offProduct) {
        return {
          product: null,
          source: "not_found" as const,
        };
      }

      // Create product from OFF data, mapped the same way `resolveScan` maps it.
      const newProduct = await ctx.db.product.create({
        data: productFromOff(offProduct, input.barcode, ctx.householdId),
      });

      return {
        product: {
          ...newProduct,
          totalStock: 0,
        },
        source: "open_food_facts" as const,
      };
    }),

  /**
   * A barcode scanned offline, resolved on reconnect (T7).
   *
   * The replayable twin of `scanBarcode`, drained one at a time from the write
   * queue. The queue carries only the barcode, so the product — with its real,
   * server-minted id — is created here, at drain time; no provisional `local:`
   * id ever reaches a component or the query cache, which is the hazard that
   * kept this out of Phase 6.
   *
   * Three outcomes, each deliberate:
   *
   * - **the barcode is already a product** (a replay after a lost reply, or a
   *   second scan of the same code): return it, claim no key, write nothing —
   *   the local lookup short-circuits before the envelope;
   * - **Open Food Facts knows it**: create the product under `withReplay`, so a
   *   replay answers from the record rather than making a second row;
   * - **nobody knows it**: `NOT_FOUND`, thrown *before* any key is claimed, so
   *   a retry of the same key can still succeed once OFF recovers — and the
   *   client turns that into the review question (a form prefilled with the
   *   barcode) rather than a dead end;
   * - **the account has spent its lookup budget** (`meterLookup`):
   *   `TOO_MANY_REQUESTS`, also before any key is claimed, which the queue
   *   turns into the same review question: the budget lasts an hour, longer
   *   than the queue would retry.
   *
   * `scanBarcode` stays NOT_REPLAYABLE on purpose: it fetches OFF *inside* the
   * resolver with no envelope. This one fetches OFF *before* the transaction,
   * so `withReplay` never holds a pooled connection across a third-party
   * request — the reason `scanBarcode` could not simply gain an envelope.
   */
  resolveScan: writeProcedure
    .input(resolveScanSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.product.findUnique({
        where: {
          barcode_householdId: {
            barcode: input.barcode,
            householdId: ctx.householdId,
          },
        },
      });

      if (existing) {
        return { product: existing, source: "local" as const };
      }

      // Before the transaction, so the envelope never wraps a network call.
      // The service fails open — an outage and an unknown barcode both return
      // null — which is exactly the connected behaviour: both land the person
      // on the create form. The meter's TOO_MANY_REQUESTS is thrown before any
      // key is claimed too, so naming the product later is not a reused key.
      const offProduct = await openFoodFacts.getProductByBarcode(
        input.barcode,
        meterLookup(ctx.session.user.id),
      );

      if (!offProduct) {
        // Thrown before withReplay claims the key, so a retry after OFF
        // recovers is not refused as a reused key.
        // Marked, so the security log does not record an unknown barcode as
        // a household lookup refused (`householdProcedure`).
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Barcode not found",
          cause: new NotHouseholdData(),
        });
      }

      return withReplay(ctx, {
        key: input.idempotencyKey,
        composedByUserId: input.composedByUserId,
        procedure: "product.resolveScan",
        input,
        apply: (tx) =>
          tx.product.create({
            data: productFromOff(offProduct, input.barcode, ctx.householdId),
          }),
        ids: (product) => [product.id],
        reread: async (db, ids) => {
          const product = await db.product.findUnique({
            where: { id: ids[0] ?? "" },
          });
          if (!product) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Product not found",
            });
          }
          return product;
        },
      }).then((product) => ({ product, source: "open_food_facts" as const }));
    }),
});
