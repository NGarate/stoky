import { z } from "zod";

export const stockOperationSchema = z.enum(["PURCHASE", "CONSUME", "ADJUST", "TRANSFER"]);

/**
 * What every stock movement carries, whatever kind it is.
 *
 * Deliberately **not** the whole input to any procedure — ISSUES.md UI-3 items
 * 1 and 2. There used to be one `stockEntrySchema` shared by `addStock`,
 * `consumeStock` and `adjustStock`, and it was wrong for all three in the same
 * two ways:
 *
 * - It required `operationType`, and every handler ignored it and wrote its own
 *   constant. A required field that changes nothing is a field a caller has to
 *   guess at, and a caller who guesses `CONSUME` on `addStock` gets a purchase.
 * - Its `quantity` was a bare `z.number()`, and two of the handlers passed it
 *   through `Math.abs`. So the server accepted `-5` on `addStock` and booked
 *   `+5`, which is the shape of thing a client is not supposed to be able to do
 *   quietly.
 *
 * The sign rule is the reason these cannot share one schema: two of them take a
 * magnitude and one takes a signed delta, and no single `quantity` is right for
 * both.
 */
const stockMovement = z.object({
  productId: z.string(),
  unit: z.string().trim().min(1),
  expirationDate: z.date().optional(),
  locationId: z.string().optional(),
  note: z.string().optional(),
});

/** Bought or otherwise brought in. A magnitude: adding minus five is not a thing. */
export const addStockSchema = stockMovement.extend({
  quantity: z.number().positive(),
});

/** Used up. Also a magnitude — the handler is what makes the row negative. */
export const consumeStockSchema = stockMovement.extend({
  batchId: z.string().min(1).optional(),
  quantity: z.number().positive(),
});

/**
 * A correction, and the one that is **signed**.
 *
 * `ReconcileDialog` sends `actual - netStock`, which is negative whenever the
 * count on the shelf is lower than the ledger — the ordinary case for a
 * reconciliation, and the reason this cannot be `.positive()` like its two
 * neighbours.
 *
 * Zero is refused, though: an adjustment of nothing writes a row that changes
 * no stock and carries a reason for a change that did not happen.
 */
export const adjustStockSchema = stockMovement.extend({
  expectedStock: z.number().optional(),
  quantity: z.number().refine((value) => value !== 0, {
    message: "An adjustment of zero changes nothing",
  }),
  reason: z.string().min(1),
});

export const storageLocationSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().optional(),
});

export const updateStorageLocationSchema = storageLocationSchema.partial().extend({
  id: z.string(),
});

export type AddStockInput = z.infer<typeof addStockSchema>;
export type ConsumeStockInput = z.infer<typeof consumeStockSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type StorageLocationInput = z.infer<typeof storageLocationSchema>;
export type UpdateStorageLocationInput = z.infer<typeof updateStorageLocationSchema>;

/**
 * What the stock list asks for.
 *
 * Cursor paging is gone. It could not survive a filter applied after the page
 * was taken: the page came back short, the cursor still pointed somewhere, and
 * there was no way to say how many rows the filter had matched. Offsets are
 * cheap at household scale and are the only way to answer "page 2".
 *
 * `sort` and `direction` are enums rather than strings because they end up in
 * an ORDER BY, which cannot be parameterised. The router maps them through a
 * closed literal whitelist; this is the other half of it.
 */
export const stockOverviewSchema = z.object({
  locationId: z.string().optional(),
  category: z.string().optional(),
  /** Part of a name. Case- and accent-insensitive; wildcards are literal. */
  search: z.string().trim().max(100).optional(),
  lowStock: z.boolean().optional(),
  needsRestock: z.boolean().optional(),
  sort: z.enum(["name", "stock"]).default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  /**
   * Bounded, and the bound is not decoration.
   *
   * `page` becomes `OFFSET (page - 1) * limit`, and Postgres takes that as a
   * bigint. `page: 1e19` is an integer as far as `.int()` is concerned, so it
   * passed, reached the database as `OFFSET 2e20`, and came back `bigint out
   * of range` — a failed query and an error screen where an empty page was
   * the honest answer.
   *
   * Ten thousand rather than something nearer the bigint ceiling: at the
   * maximum `limit` of 100 that is a million rows, which no household's
   * cupboards will hold, and a number a person can actually reach by paging
   * is worth more as a bound than one chosen to fit a machine word.
   */
  page: z.number().int().min(1).max(10_000).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export type StockOverviewInput = z.infer<typeof stockOverviewSchema>;
export type StockSort = StockOverviewInput["sort"];
export type StockDirection = StockOverviewInput["direction"];
