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
  allocateFefo,
  daysUntilExpiry,
  endOfDayAfter,
  netStock,
  remainingByBatch,
  startOfToday,
} from "@/lib/inventory/batches";
import { replayable } from "@/lib/validations/idempotency";
import { MAX_DAYS, MAX_PRICE, MAX_QUANTITY } from "@/lib/validations/bounds";
import { withReplay } from "../replay";
import type {
  StockDirection,
  StockOverviewInput,
  StockSort,
} from "@/lib/validations/inventory";
// The value namespace, not only the type: `Prisma.sql` is a function.
import {
  Prisma,
  type PrismaClient,
  type StockOperation,
} from "@prisma/client";

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
        // Read the full ledger before filtering locations: an unlocated
        // withdrawal can make a dated batch's quantity unknown.
        include: { location: true },
      },
    },
  });

  const batches = [];

  for (const { stockEntries, ...product } of products) {
    const remaining = remainingByBatch(stockEntries);

    for (const entry of stockEntries) {
      if (locationId && entry.locationId !== locationId) continue;
      const expirationDate = entry.expirationDate;
      if (expirationDate === null) continue;

      const left = remaining.get(entry.id);
      if (left === undefined || left === 0) continue;

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

/**
 * Stock: what is in the house, what goes in, what comes out.
 *
 * **Stock is a ledger, not a number.** There is no "current quantity" column
 * anywhere; a `StockEntry` is one movement, positive for a purchase and
 * negative for a consumption, and what is on the shelf is their sum. Every
 * surprise in this file follows from that — why an availability check has to
 * read a product's whole history, why `consumeStock` writes a negative row
 * rather than editing a positive one, and why INV-1 was possible at all
 * (both guards summed only the positive rows and so measured gross purchases).
 *
 * **Two of these are replayable** — `addStock` and `consumeStock`, the two a
 * shop composes — because Phase 4's offline queue may send the same write twice — see `src/server/trpc/replay.ts`. Those carry an
 * `idempotencyKey` and run inside one transaction with the product row held.
 */
/**
 * Accent folding, in the only language the database speaks.
 *
 * `datcollate` on the shipped image is en_US.utf8 on musl, which collates by
 * byte: `ORDER BY lower(name)` files "Ávila" and "Ñoquis" *after* "Zumo".
 * Measured against the dev database. `COLLATE "es-x-icu"` fixes it and exists
 * on that image, but a self-hosted Postgres built without ICU would fail this
 * query outright — and this is the inventory's main query, not a nicety. So
 * the fold is done with `translate`, which depends on nothing.
 *
 * One fragment for sorting *and* searching, deliberately: the two have to
 * agree about which letters are the same letter, or "cafe" finds a row the
 * sort then files somewhere else. The cost is that "ñ" folds onto "n", so the
 * RAE's ordering is lost on ties, and that a trigram index cannot serve the
 * folded predicate. Both are stated rather than discovered.
 */
const ACCENTED = "áàäâãéèëêíìïîóòöôõúùüûñç";
const UNACCENTED = "aaaaaeeeeiiiiooooouuuunc";

const folded = (value: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`translate(lower(${value}), ${ACCENTED}, ${UNACCENTED})`;

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

/** One row as Postgres hands it back. Every number is already a JS number. */
interface StockOverviewRow {
  id: string;
  name: string;
  category: string | null;
  defaultUnit: string;
  minStock: number | null;
  totalStock: number;
  /** Unticked, product-linked, on any of this household's lists. */
  onListQuantity: number;
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
 * - **`::float8` on the aggregate.** `ROUND(…, 2)` returns `numeric`, which
 *   arrives as a Decimal object and reaches the browser as `{ s, e, d }`. The
 *   rounding itself matches `projectStockTotals`, so the figure the offline
 *   queue projects and the figure the server returns are the same number
 *   rather than the same number plus 4e-17.
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
        ROUND(COALESCE(SUM(entry.quantity), 0)::numeric, 2)::float8 AS "totalStock"
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
        SUM(item.quantity)::float8 AS quantity
      FROM "ShoppingItem" item
      JOIN "ShoppingList" list ON list.id = item."shoppingListId"
      WHERE list."householdId" = ${householdId}
        AND item."isChecked" = false
        AND item."productId" IS NOT NULL
      GROUP BY item."productId"
    )
    SELECT
      totals.*,
      COALESCE("onList".quantity, 0)::float8 AS "onListQuantity"
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
 * path is factor 1.
 */
function inProductUnit<T extends { quantity: number; unit: string }>(
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
  return { ...input, quantity: input.quantity * factor, unit: defaultUnit };
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
          price: z.number().positive().finite().max(MAX_PRICE).optional(),
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
          await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;
          const entry = await tx.stockEntry.create({
            data: {
              productId: input.productId,
              quantity: movement.quantity,
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

          if (input.price && input.price > 0 && input.storeId) {
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
   * Records something used up, as a negative entry.
   *
   * `householdProcedure`, not `writeProcedure`, and that is the capability
   * matrix rather than an oversight: a KITCHEN account may look, use one up
   * and write down what is needed — nothing else (REDESIGN_PLAN §5.2, amended
   * by the owner's pass; D88). This was the first of its three writes.
   *
   * Refuses to take stock below zero — CONFLICT, checked against *net* stock
   * inside a transaction with the product row held (`SELECT … FOR UPDATE`), so
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
          consumeFromLocationId: z.string().optional(),
        })
        .merge(replayable)
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
                orderBy: { createdAt: "asc" },
              },
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
          const batch = input.batchId
            ? product.stockEntries.find((entry) => entry.id === input.batchId && entry.quantity > 0)
            : undefined;
          if (input.batchId && !batch) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Batch not found" });
          }
          if (batch && (unitConversion(batch.unit, movement.unit) !== 1 || (locationId && locationId !== batch.locationId))) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Batch unit or location does not match" });
          }
          const scopedEntries = product.stockEntries.filter((entry) => !locationId || entry.locationId === locationId);
          // Rounded as the screens round it (`netStock`): 1 − 0.9 is
          // 0.09999999999999998, which every screen shows as 0.1, and an
          // unrounded guard then refuses the 0.1 the person can see.
          const totalAvailable = netStock(scopedEntries);
          if (batch) {
            const left = remainingByBatch(product.stockEntries).get(batch.id);
            if (left == null || movement.quantity > left) {
              throw new TRPCError({ code: "CONFLICT", message: "Batch quantity needs confirmation" });
            }
          }

          if (movement.quantity > totalAvailable) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Not enough stock available",
            });
          }

          return tx.stockEntry.create({
            data: {
              productId: input.productId,
              quantity: -movement.quantity,
              unit: movement.unit,
              batchId: batch?.id,
              locationId: batch ? batch.locationId : locationId,
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
        await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;
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
        const total = await tx.stockEntry.aggregate({ where: { productId: input.productId }, _sum: { quantity: true } });
        const current = Math.round((total._sum.quantity ?? 0) * 100) / 100;
        if (input.expectedStock !== undefined) {
          if (current !== Math.round(input.expectedStock * 100) / 100) {
            throw new TRPCError({ code: "CONFLICT", message: "Stock changed; refresh before adjusting" });
          }
        }
        // The floor `consumeStock` has. `expectedStock` is optional, so without
        // this a correction larger than the ledger drove the product negative.
        // Rounded like every other guard, so a recount to exactly zero is not
        // refused over 1e-17 of float residue.
        if (Math.round((current + movement.quantity) * 100) / 100 < 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Adjustment would take stock below zero" });
        }
        const stockEntry = await tx.stockEntry.create({
          data: {
            productId: input.productId,
            quantity: movement.quantity,
            unit: movement.unit,
            expirationDate: input.expirationDate,
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
        productId: z.string(),
        quantity: z.number().positive().finite().max(MAX_QUANTITY),
        unit: z.string(),
        fromLocationId: z.string(),
        toLocationId: z.string(),
        note: z.string().optional(),
      })
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
          await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;

          const product = await tx.product.findFirst({
            where: {
              id: input.productId,
              householdId: ctx.householdId,
            },
            include: {
              // The whole ledger, not only the source shelf: what is left of
              // each batch there depends on withdrawals recorded anywhere
              // (`remainingByBatch`).
              stockEntries: { orderBy: { createdAt: "asc" } },
            },
          });

          if (!product) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Product not found",
            });
          }

          const movement = inProductUnit(input, product.defaultUnit);
          // Every entry at the source, not only the positive ones: `gt: 0`
          // counted what arrived and not what left, so a shelf with six in and
          // four out offered six to move (INV-1). Rounded like
          // `consumeStock`'s guard, for the same reason.
          const availableInSource = netStock(
            product.stockEntries.filter((entry) => entry.locationId === input.fromLocationId),
          );

          if (movement.quantity > availableInSource) {
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

          /**
           * One pair of rows per batch moved, soonest expiry first.
           *
           * The pair used to be one undated row each way with no `batchId`,
           * so the source batch was drawn down (or made unknown) by the move
           * and what arrived had no date: moved milk vanished from the
           * expiring and expired screens. The outgoing row now names the
           * batch it leaves, and the incoming one carries that batch's date.
           * There is no screen that asks which batch to move, so FEFO
           * (`allocateFefo`) chooses; anything it cannot place in a batch
           * with a known remainder moves undated, as before.
           */
          const { parts, unassigned } = allocateFefo(
            product.stockEntries,
            input.fromLocationId,
            movement.quantity,
          );
          const moves: Array<{ quantity: number; batchId?: string; expirationDate?: Date | null }> =
            parts.map(({ batch, quantity }) => ({
              quantity,
              batchId: batch.id,
              expirationDate: batch.expirationDate,
            }));
          if (unassigned > 0) moves.push({ quantity: unassigned });

          const toName = locations.find((l) => l.id === input.toLocationId)?.name;
          const fromName = locations.find((l) => l.id === input.fromLocationId)?.name;
          const fromEntries = [];
          const toEntries = [];
          for (const move of moves) {
            fromEntries.push(await tx.stockEntry.create({
              data: {
                productId: input.productId,
                quantity: -move.quantity,
                unit: movement.unit,
                batchId: move.batchId,
                locationId: input.fromLocationId,
                operationType: "TRANSFER" as StockOperation,
                note: input.note || `Transfer to ${toName}`,
                createdBy: userId,
              },
              include: { product: true, location: true },
            }));
            toEntries.push(await tx.stockEntry.create({
              data: {
                productId: input.productId,
                quantity: move.quantity,
                unit: movement.unit,
                expirationDate: move.expirationDate,
                locationId: input.toLocationId,
                operationType: "TRANSFER" as StockOperation,
                note: input.note || `Transfer from ${fromName}`,
                createdBy: userId,
              },
              include: { product: true, location: true },
            }));
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

  /**
   * Batches that will expire within `days`, soonest first.
   *
   * The kitchen screen's whole reason to exist. Reports each batch's
   * **remaining** quantity, not the quantity it was bought with: consumption is
   * a separate negative row with no expiry date of its own, so drawing it down
   * across dated batches is arithmetic this file does rather than something the
   * database can answer (`remainingByBatch`). Getting that wrong was INV-1 —
   * six litres bought and four drunk read as six expiring.
   *
   * `isExpiringSoon` at three days is the threshold the kitchen screen uses to
   * decide what takes space.
   */
  getExpiringItems: householdProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(MAX_DAYS).default(7),
        locationId: z.string().optional(),
      })
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
          isExpiringSoon: daysLeft <= 3,
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
        locationId: z.string().optional(),
      })
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

      return batches
        .map((batch) => ({
          ...batch,
          // One measurement, negated — not a second one in the other
          // direction. Rounding elapsed time *up*, which is what this did
          // before, reported a carton four days and one second gone as five
          // days gone. Days remaining and days elapsed are the same distance.
          daysExpired: -daysUntilExpiry(batch.expirationDate, today),
        }))
        // Newest first, matching the previous `expirationDate: "desc"`.
        .reverse();
    }),
});
