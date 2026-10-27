import { unitConversion } from "@/lib/inventory/units";
import { TRPCError } from "@trpc/server";
import { isLowStock } from "@/lib/stock/low-stock";
import { z } from "zod";
import { createTRPCRouter, householdProcedure, writeProcedure } from "../trpc";
import {
  addStockSchema,
  adjustStockSchema,
  consumeStockSchema,
  stockOverviewSchema,
} from "@/lib/validations/inventory";
import {
  daysUntilExpiry,
  endOfDayAfter,
  EXPIRING_SOON_DAYS,
  startOfToday,
} from "@/lib/inventory/batches";
import { allocate, withdraw } from "@/lib/stock/withdraw";
import { replayable } from "@/lib/validations/idempotency";
import {
  MAX_DAYS,
  MAX_ID_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PAGE_SIZE,
  MAX_UNIT_LENGTH,
} from "@/lib/validations/bounds";
import { withReplay } from "../replay";
import { folded } from "@/server/fold";
import type {
  StockDirection,
  StockOverviewInput,
  StockSort,
} from "@/lib/validations/inventory";
import {
  priceSchema,
  QUANTITY_PLACES,
  quantitySchema,
} from "@/lib/validations/amounts";
// The value namespace, not only the type: `Prisma.sql` is a function.
import {
  Prisma,
  type PrismaClient,
  type StockOperation,
} from "@/generated/prisma/client";

/** Half-open bounds on an expiry date, in the shape Prisma words them. */
interface ExpiryWindow {
  gte?: Date;
  lte?: Date;
  lt?: Date;
}

/**
 * Dated batches with something still in them, whose date falls in `window`,
 * soonest first — one query on the stored balances.
 *
 * Each row reports what is **left** of its batch, not what was bought: six
 * litres bought and four drunk is two expiring (ISSUES.md INV-1, where the
 * purchase's own quantity was reported). The field keeps the name `quantity`
 * because that is what every caller already means by it.
 */
async function datedBatchesInWindow(
  db: Prisma.TransactionClient,
  householdId: string,
  locationId: string | undefined,
  window: ExpiryWindow,
) {
  const batches = await db.stockEntry.findMany({
    where: {
      product: { householdId },
      remaining: { gt: 0 },
      expirationDate: { not: null, ...window },
      ...(locationId && { locationId }),
    },
    include: { location: true, product: true },
    orderBy: [{ expirationDate: "asc" }, { createdAt: "asc" }],
  });

  return batches.map(({ remaining, expirationDate, ...batch }) => ({
    ...batch,
    // Both narrowed by the `where` above.
    quantity: remaining!,
    expirationDate: expirationDate!,
  }));
}

/**
 * Stock: what is in the house, what goes in, what comes out.
 *
 * **Stock is a ledger, with a balance per batch.** A `StockEntry` is one
 * movement, positive for a batch coming in and negative for one going out, and
 * what is on the shelf is their sum. Rows are never edited, except a batch's
 * `remaining`, which every withdrawal lowers in the same transaction that
 * writes it. So every withdrawal names its batch: one the caller chose, or the
 * soonest to expire (`allocate`), and the guards ask the balances rather than
 * replaying a product's history.
 *
 * **Two of these are replayable** — `addStock` and `consumeStock`, the two a
 * shop composes — because Phase 4's offline queue may send the same write twice — see `src/server/trpc/replay.ts`. Those carry an
 * `idempotencyKey` and run inside one transaction with the product row held.
 */

/**
 * The sort keys, as SQL fragments.
 *
 * ORDER BY cannot be parameterised, so this is the whitelist: a closed literal
 * map from the values `stockOverviewSchema` accepts. `Record<StockSort, …>`
 * makes both drifts a type error — a key added to the schema with no fragment,
 * and a fragment for a key the schema will never send.
 */
const SORT_COLUMNS: Record<StockSort, Prisma.Sql> = {
  name: folded(Prisma.sql`rows.name`),
  stock: Prisma.sql`rows."totalStock"`,
};

const SORT_DIRECTIONS: Record<StockDirection, Prisma.Sql> = {
  asc: Prisma.sql`ASC`,
  desc: Prisma.sql`DESC`,
};

/** A search term as a LIKE pattern, with the wildcards a person typed made literal. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, "\\$&")}%`;
}

/** One row as Postgres hands it back: `numeric` arrives as a Decimal. */
interface StockOverviewRow {
  id: string;
  name: string;
  category: string | null;
  defaultUnit: string;
  minStock: Prisma.Decimal | null;
  totalStock: Prisma.Decimal;
  /** Unticked, product-linked, on any of this household's lists. */
  onListQuantity: Prisma.Decimal;
}

/**
 * Every product this request matches, with its net stock — one row per product.
 *
 * Returned as a fragment rather than run, because the page and the count are
 * the same question asked twice, and writing the filter out twice is how the
 * two come to disagree.
 *
 * Two things in here are load-bearing and easy to undo by accident:
 *
 * - **The location filter is in the `ON` clause, not the `WHERE`.** A product
 *   with nothing in the chosen location has to appear with a total of zero.
 *   Moved into the `WHERE`, the LEFT JOIN silently becomes an inner one and
 *   the product vanishes, which answers a different question from the one the
 *   screen asks.
 * - **`onList` is aggregated before it is joined.** Joined raw, each of a
 *   product's stock entries would pair with each of its list items and
 *   multiply both sums — three entries and two items would report six times
 *   the stock and three times the list.
 */
function matchingProducts(
  input: StockOverviewInput,
  householdId: string,
): Prisma.Sql {
  const inLocation = input.locationId
    ? Prisma.sql`AND entry."locationId" = ${input.locationId}`
    : Prisma.empty;

  const inCategory = input.category
    ? Prisma.sql`AND product.category = ${input.category}`
    : Prisma.empty;

  const matchesSearch = input.search
    ? Prisma.sql`AND ${folded(Prisma.sql`product.name`)} LIKE ${folded(
        Prisma.sql`${likePattern(input.search)}`,
      )}`
    : Prisma.empty;

  // `src/lib/stock/low-stock.ts` owns what running out means; this is that
  // rule in SQL, because the database cannot import TypeScript. An integration
  // case asks both over the same rows so they cannot drift apart.
  const below = Prisma.sql`(totals."minStock" IS NOT NULL AND totals."totalStock" < totals."minStock")`;
  const onlyLow = input.lowStock ? Prisma.sql`AND ${below}` : Prisma.empty;
  const onlyRestock = input.needsRestock
    ? Prisma.sql`AND (totals."totalStock" <= 0 OR ${below})`
    : Prisma.empty;

  return Prisma.sql`
    WITH totals AS (
      SELECT
        product.id,
        product.name,
        product.category,
        product."defaultUnit",
        product."minStock",
        COALESCE(SUM(entry.quantity), 0) AS "totalStock"
      FROM "Product" product
      LEFT JOIN "StockEntry" entry
        ON entry."productId" = product.id
        ${inLocation}
      WHERE product."householdId" = ${householdId}
        ${inCategory}
        ${matchesSearch}
      GROUP BY product.id
    ),
    "onList" AS (
      SELECT
        item."productId" AS "productId",
        SUM(item.quantity) AS quantity
      FROM "ShoppingItem" item
      JOIN "ShoppingList" list ON list.id = item."shoppingListId"
      JOIN "Product" listed ON listed.id = item."productId"
      WHERE list."householdId" = ${householdId}
        AND item."isChecked" = false
        AND item."productId" IS NOT NULL
        -- In the product's unit only, as isProductUnit (units.ts) says.
        AND (item.unit IS NULL
          OR lower(trim(item.unit)) = lower(trim(listed."defaultUnit")))
      GROUP BY item."productId"
    )
    SELECT
      totals.*,
      COALESCE("onList".quantity, 0) AS "onListQuantity"
    FROM totals
    LEFT JOIN "onList" ON "onList"."productId" = totals.id
    WHERE true ${onlyLow} ${onlyRestock}
  `;
}

/**
 * Refuse a storage location that is not this household's.
 *
 * `addStock` has verified this inline since it was written; its three siblings
 * took the same field from the same input and wrote it onto a `StockEntry`
 * unchecked. The row lands in the caller's own household — the *product* is
 * checked — but it points at somebody else's shelf, and `/products/[id]`
 * renders `entry.location?.name`, so a guessed id leaks what another household
 * calls its storage.
 *
 * NOT_FOUND rather than FORBIDDEN, matching `addStock` and the rest of this
 * codebase: telling an outsider that an id exists but is not theirs confirms
 * the id exists.
 *
 * Takes the transaction client where there is one, so the check and the write
 * see the same snapshot — a location deleted between them would otherwise slip
 * through the guard and fail at the foreign key instead.
 */
async function assertOwnLocation(
  db: Pick<PrismaClient, "storageLocation"> | Prisma.TransactionClient,
  locationId: string | null | undefined,
  householdId: string,
): Promise<void> {
  if (!locationId) return;

  const location = await db.storageLocation.findFirst({
    where: { id: locationId, householdId },
    select: { id: true },
  });

  if (!location) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });
  }
}

/**
 * A movement, restated in the product's own unit.
 *
 * Every row of a product's ledger is summed as one number, and
 * `product.update` already assumes every row is in `defaultUnit` when it
 * converts them on a unit change. The movements below took any free-text unit
 * and stored it as given, so 500 "g" into a product counted in "kg" summed to
 * 501. A unit with a known conversion (dozens to units, or the same unit in a
 * different case) is converted; anything else is refused rather than guessed.
 *
 * The forms send the product's unit unless a person edits it, so the ordinary
 * path is factor 1. A converted amount is put back at the column's scale, and
 * one that rounds to nothing there (half a gram into kilos) is refused rather
 * than written as zero.
 */
function inProductUnit<T extends { quantity: Prisma.Decimal; unit: string }>(
  input: T,
  defaultUnit: string,
): T {
  const factor = unitConversion(input.unit, defaultUnit);
  if (factor === undefined) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unit cannot be converted to the product's unit",
    });
  }
  const quantity = input.quantity
    .times(factor)
    .toDecimalPlaces(QUANTITY_PLACES);
  if (quantity.isZero()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Quantity is too small for the product's unit",
    });
  }
  return { ...input, quantity, unit: defaultUnit };
}

export const inventoryRouter = createTRPCRouter({
  /**
   * Every product in the household, with its net stock — one page of it.
   *
   * Filter, sort, page and total all happen in Postgres. They used to happen
   * in three places: the page was taken by cursor, the totals were summed in
   * JavaScript from every ledger row of every product on it, and the filters
   * were applied *after* that. So a page came back shorter than it asked for,
   * there was no total to show, and page two of a filtered list was a
   * different set from the one page one implied.
   *
   * Both filters ask `src/lib/stock/low-stock.ts` — restated in SQL, because
   * the database cannot import TypeScript, and held to it by an integration
   * case that asks both over the same rows. Phase 8 item 2 is why that
   * matters: the Panel's count and the list it opens must be one question.
   *
   * The page and the count are the same filter run twice, from one fragment,
   * inside one transaction — so the total cannot describe a different set from
   * the rows, and a page past the end still knows how many rows there are.
   */
  getStockOverview: householdProcedure
    .input(stockOverviewSchema)
    .query(async ({ ctx, input }) => {
      const matching = matchingProducts(input, ctx.householdId);

      const [rows, [count]] = await ctx.db.$transaction([
        ctx.db.$queryRaw<StockOverviewRow[]>(Prisma.sql`
          WITH rows AS (${matching})
          SELECT * FROM rows
          ORDER BY ${SORT_COLUMNS[input.sort]} ${SORT_DIRECTIONS[input.direction]}, rows.id ASC
          LIMIT ${input.limit} OFFSET ${(input.page - 1) * input.limit}
        `),
        ctx.db.$queryRaw<[{ total: number }]>(Prisma.sql`
          WITH rows AS (${matching})
          SELECT COUNT(*)::int AS total FROM rows
        `),
      ]);

      const total = count.total;

      return {
        // The only derivation left in TypeScript, and deliberately so: the
        // flag the screen reads comes from the same function the SQL filter
        // mirrors, applied to the same rounded figure the row carries. A row
        // cannot come back marked low and be filtered out as healthy.
        products: rows.map((row) => ({
          ...row,
          isLowStock: isLowStock(row.totalStock, row.minStock),
        })),
        total,
        page: input.page,
        pageCount: Math.max(1, Math.ceil(total / input.limit)),
      };
    }),

  /**
   * Records something brought into the house.
   *
   * Optionally records what it cost, which is the only way a `PriceRecord` is
   * created outside the receipt pipeline — and the reason this procedure had a
   * cross-household hole (SEC-1): it wrote the price against whatever `storeId`
   * it was given, without checking the store belonged to the caller's
   * household, while `price.recordPrice` verified the identical write. The
   * store is now checked alongside the product and the location, before
   * anything is written.
   *
   * Replayable. A shop composed in a supermarket basement may arrive twice.
   */
  addStock: writeProcedure
    .input(
      addStockSchema
        .extend({
          // A zero or negative price used to pass validation and silently
          // write no record (PRICE-1); refused at the edge instead, where the
          // person can fix it.
          price: priceSchema.optional(),
          storeId: z.string().max(MAX_ID_LENGTH).optional(),
        })
        .merge(replayable),
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

      const movement = inProductUnit(input, product.defaultUnit);

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
          await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} AND "householdId" = ${ctx.householdId} FOR UPDATE`;
          const entry = await tx.stockEntry.create({
            data: {
              productId: input.productId,
              quantity: movement.quantity,
              remaining: movement.quantity,
              unit: movement.unit,
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

          if (input.price && input.storeId) {
            await tx.priceRecord.create({
              data: {
                productId: input.productId,
                storeId: input.storeId,
                price: input.price,
                unit: movement.unit,
                quantity: movement.quantity,
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

  /**
   * Records something used up, as a negative entry per batch it came out of.
   *
   * `householdProcedure`, not `writeProcedure`, and that is the capability
   * matrix rather than an oversight: a KITCHEN account may look, use one up
   * and write down what is needed — nothing else (REDESIGN_PLAN §5.2, amended
   * by the owner's pass; D88). This was the first of its three writes.
   *
   * Refuses to take more than the batches hold — CONFLICT, checked against
   * their balances inside a transaction with the product row held
   * (`SELECT … FOR UPDATE`), so
   * two people consuming the last unit at once cannot both succeed. The offline
   * queue treats that CONFLICT as reconcilable rather than as a failure: it
   * asks the person what is actually on the shelf, because the alternative is
   * discarding something they really did use.
   *
   * Replayable.
   */
  consumeStock: householdProcedure
    .input(
      consumeStockSchema
        .extend({
          consumeFromLocationId: z.string().max(MAX_ID_LENGTH).optional(),
        })
        .merge(replayable),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Before the replay envelope, so a change composed offline is refused on
      // the same terms as one made online — a queued write is a caller that is
      // not a page, which is the reason SEC-1's sibling test lives where it does.
      //
      // `||`, not `??`, so this resolves to exactly what the write below
      // resolves to (`consumeFromLocationId || locationId`): the two diverged
      // on the empty string, where `??` kept `""` and short-circuited the
      // guard while `||` fell the write through to an unchecked `locationId`.
      // The guard must check the id that will actually be written.
      await assertOwnLocation(
        ctx.db,
        input.consumeFromLocationId || input.locationId,
        ctx.householdId,
      );

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
           *
           * The household is in the lock's own WHERE, not only in the
           * `findFirst` below. Without it the lock ran before anything had
           * checked the id, so a caller holding another household's product
           * id locked that household's row, and waited on it whenever its
           * owner held it — authorise-after-act, and a timing oracle on
           * someone else's activity. Postgres filters before it locks, so a
           * foreign id now locks nothing and waits on nothing; the
           * `findFirst` stays the authoritative refusal. Every product lock
           * in this file and in `product.update` carries the same predicate.
           */
          await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} AND "householdId" = ${ctx.householdId} FOR UPDATE`;

          const product = await tx.product.findFirst({
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

          const movement = inProductUnit(input, product.defaultUnit);
          const locationId = input.consumeFromLocationId || input.locationId;
          if (input.batchId) {
            const batch = await tx.stockEntry.findFirst({
              where: {
                id: input.batchId,
                productId: product.id,
                quantity: { gt: 0 },
              },
            });
            if (!batch) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Batch not found",
              });
            }
            if (
              unitConversion(batch.unit, movement.unit) !== 1 ||
              (locationId && locationId !== batch.locationId)
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Batch unit or location does not match",
              });
            }
          }

          // The batch asked for, or the soonest to expire on the shelf asked
          // for — anywhere, when none was.
          const parts = await allocate(tx, product.id, movement.quantity, {
            batchId: input.batchId,
            locationId,
          });
          if (!parts) {
            throw new TRPCError({
              code: "CONFLICT",
              message: input.batchId
                ? "Batch quantity needs confirmation"
                : "Not enough stock available",
            });
          }

          return withdraw(tx, parts, {
            productId: product.id,
            unit: movement.unit,
            operationType: "CONSUME",
            note: input.note,
            createdBy: userId,
          });
        },
        ids: (entries) => entries.map((entry) => entry.id),
        // In the order they were written, which is FEFO's.
        reread: (db, ids) =>
          db.stockEntry.findMany({
            where: { id: { in: ids } },
            include: { product: true, location: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          }),
      });
    }),

  /**
   * Corrects the ledger to match the shelf.
   *
   * The only one of these that takes a **signed** quantity: `ReconcileDialog`
   * sends `actual - netStock`, which is negative whenever the count is lower
   * than the ledger — the ordinary case. Zero is refused, since an adjustment
   * of nothing records a change that did not happen.
   *
   * Deliberately **not** replayable. It is absolute in intent rather than
   * incremental, and replaying it would apply the same correction twice; the
   * dialog that sends it is a person answering a question, not a queued write.
   */
  adjustStock: writeProcedure
    .input(adjustStockSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await assertOwnLocation(ctx.db, input.locationId, ctx.householdId);

      return ctx.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} AND "householdId" = ${ctx.householdId} FOR UPDATE`;
        // Verify product exists and belongs to household
        const product = await tx.product.findFirst({
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

        const movement = inProductUnit(input, product.defaultUnit);
        const total = await tx.stockEntry.aggregate({
          where: { productId: input.productId },
          _sum: { quantity: true },
        });
        const current = total._sum.quantity ?? new Prisma.Decimal(0);
        if (input.expectedStock !== undefined) {
          if (!current.equals(input.expectedStock)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Stock changed; refresh before adjusting",
            });
          }
        }
        if (movement.quantity.greaterThan(0)) {
          // More on the shelf than the ledger knew: a batch of its own.
          return [
            await tx.stockEntry.create({
              data: {
                productId: input.productId,
                quantity: movement.quantity,
                remaining: movement.quantity,
                unit: movement.unit,
                expirationDate: input.expirationDate,
                locationId: input.locationId,
                operationType: "ADJUST" as StockOperation,
                note: input.reason,
                createdBy: userId,
              },
              include: { product: true, location: true },
            }),
          ];
        }

        // Less: taken from the batches like a consumption, soonest to expire
        // first, which is also the floor — a correction larger than what the
        // batches hold would take the product below zero.
        const parts = await allocate(
          tx,
          input.productId,
          movement.quantity.negated(),
          { locationId: input.locationId },
        );
        if (!parts) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Adjustment would take stock below zero",
          });
        }
        return withdraw(tx, parts, {
          productId: input.productId,
          unit: movement.unit,
          operationType: "ADJUST",
          note: input.reason,
          createdBy: userId,
        });
      });
    }),

  /**
   * Moves stock between locations, as two entries rather than an edit.
   *
   * A negative row at the origin and a positive one at the destination, in one
   * transaction — the ledger has no notion of a row moving. The availability
   * guard holds the product row for the same reason `consumeStock` does
   * (INV-2): read-then-write let two concurrent transfers each see the same
   * four litres and move eight.
   */
  transferStock: writeProcedure
    .input(
      z.object({
        productId: z.string().max(MAX_ID_LENGTH),
        quantity: quantitySchema,
        unit: z.string().max(MAX_UNIT_LENGTH),
        fromLocationId: z.string().max(MAX_ID_LENGTH),
        toLocationId: z.string().max(MAX_ID_LENGTH),
        note: z.string().max(MAX_NOTE_LENGTH).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Both ends. A check on one is a check somebody later assumes covers the
      // other, and a transfer has two chances to name a shelf that is not yours.
      await assertOwnLocation(ctx.db, input.fromLocationId, ctx.householdId);
      await assertOwnLocation(ctx.db, input.toLocationId, ctx.householdId);

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
          await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} AND "householdId" = ${ctx.householdId} FOR UPDATE`;

          const product = await tx.product.findFirst({
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

          const movement = inProductUnit(input, product.defaultUnit);

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

          /**
           * One pair of rows per batch moved, soonest expiry first.
           *
           * There is no screen that asks which batch to move, so FEFO
           * (`allocate`) chooses. The outgoing row names the batch it leaves;
           * the incoming one is a batch of its own at the destination, with
           * the date of the one it came from, so moved milk stays on the
           * expiring and expired screens.
           */
          const parts = await allocate(tx, product.id, movement.quantity, {
            locationId: input.fromLocationId,
          });
          if (!parts) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Not enough stock in source location",
            });
          }

          const toName = locations.find(
            (l) => l.id === input.toLocationId,
          )?.name;
          const fromName = locations.find(
            (l) => l.id === input.fromLocationId,
          )?.name;
          const fromEntries = await withdraw(tx, parts, {
            productId: product.id,
            unit: movement.unit,
            operationType: "TRANSFER",
            note: input.note || `Transfer to ${toName}`,
            createdBy: userId,
          });
          const toEntries = [];
          for (const { batch, quantity } of parts) {
            toEntries.push(
              await tx.stockEntry.create({
                data: {
                  productId: product.id,
                  quantity,
                  remaining: quantity,
                  unit: movement.unit,
                  expirationDate: batch.expirationDate,
                  locationId: input.toLocationId,
                  operationType: "TRANSFER" as StockOperation,
                  note: input.note || `Transfer from ${fromName}`,
                  createdBy: userId,
                },
                include: { product: true, location: true },
              }),
            );
          }

          return { fromEntries, toEntries };
        },
        { maxWait: 5_000, timeout: 10_000 },
      );
    }),

  /**
   * One product's movements, newest first, cursor-paginated.
   *
   * The ledger made visible: this is the only screen that shows *why* the
   * number is what it is, which matters when somebody disagrees with it.
   */
  getStockHistory: householdProcedure
    .input(
      z.object({
        productId: z.string().max(MAX_ID_LENGTH),
        cursor: z.string().max(MAX_ID_LENGTH).optional(),
        // `.int()`: Prisma truncates a fractional `take`, so 2.5 was a page of
        // two rows with a cursor, not an error. A page size is a count.
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
      }),
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

  /**
   * Batches that will expire within `days`, soonest first.
   *
   * The kitchen screen's whole reason to exist. Reports each batch's
   * **remaining** quantity, its stored balance, not the quantity it was bought
   * with. Getting that wrong was INV-1 — six litres bought and four drunk read
   * as six expiring.
   *
   * `isExpiringSoon` at `EXPIRING_SOON_DAYS` is the threshold the kitchen uses to
   * decide what takes space.
   */
  getExpiringItems: householdProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(MAX_DAYS).default(7),
        locationId: z.string().max(MAX_ID_LENGTH).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Calendar days, not instants (`startOfToday`): a batch dated today
      // is expiring today, and `days` ahead includes that whole last day.
      const today = startOfToday();

      const batches = await datedBatchesInWindow(
        ctx.db,
        ctx.householdId,
        input.locationId,
        { gte: today, lt: endOfDayAfter(today, input.days) },
      );

      return batches.map((batch) => {
        const daysLeft = daysUntilExpiry(batch.expirationDate, today);

        return {
          ...batch,
          daysUntilExpiry: daysLeft,
          isExpiringSoon: daysLeft <= EXPIRING_SOON_DAYS,
        };
      });
    }),

  /**
   * Batches whose date has already passed, with something still in them.
   *
   * The same arithmetic as `getExpiringItems` over the other side of today.
   * Separate rather than a negative `days`, because the two answer different
   * questions — one is "cook this", the other is "throw this away" — and the
   * kitchen screen shows them differently.
   */
  getExpiredItems: householdProcedure
    .input(
      z.object({
        locationId: z.string().max(MAX_ID_LENGTH).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Expired means dated before today — not before this instant, which
      // listed milk as expired on the morning of the day printed on it.
      const today = startOfToday();

      const batches = await datedBatchesInWindow(
        ctx.db,
        ctx.householdId,
        input.locationId,
        { lt: today },
      );

      return (
        batches
          .map((batch) => ({
            ...batch,
            // One measurement, negated — not a second one in the other
            // direction. Rounding elapsed time *up*, which is what this did
            // before, reported a carton four days and one second gone as five
            // days gone. Days remaining and days elapsed are the same distance.
            daysExpired: -daysUntilExpiry(batch.expirationDate, today),
          }))
          // Newest first, matching the previous `expirationDate: "desc"`.
          .reverse()
      );
    }),
});
