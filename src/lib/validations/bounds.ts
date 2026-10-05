/**
 * The outer edges of what a household could mean, shared by every schema.
 *
 * Not product rules — nobody's flour is checked against these — but the line
 * past which a number is a mistake or an attack rather than an amount:
 *
 * - **Infinity.** Zod 3's `z.number()` accepts it — `.positive()` too — and
 *   superjson carries it across the wire intact, so `quantity: Infinity`
 *   passed validation, and a `double precision` column will store it. One
 *   such row and every sum over the ledger is Infinity.
 * - **Unbounded page sizes.** `product.searchByName` interpolates its `limit`
 *   into `LIMIT ${…}`: `-1` was a Postgres error that surfaced as a 500, and a
 *   billion asked the database for every row it had.
 * - **Unbounded day windows.** `price.getPriceHistory` subtracts `days` from
 *   today; `1e12` is an Invalid Date that reaches Prisma.
 * - **Unbounded search strings**, which go into `pg_trgm` similarity and an
 *   `ILIKE` on every keystroke.
 *
 * The numbers are generous on purpose. A tonne in grams is a quantity nobody
 * stocks, and a price of a million is one nobody pays at a supermarket; a
 * limit set where real use could reach it is a bug filed by the first person
 * who does.
 */

/** A million of the unit: a tonne in grams, a thousand litres in millilitres. */
export const MAX_QUANTITY = 1_000_000;

/** In the record's currency. */
export const MAX_PRICE = 1_000_000;

/** What a search box sends. Longer is a paste accident or a probe. */
export const MAX_SEARCH_LENGTH = 100;

/** Rows per page, for every list that pages. */
export const MAX_PAGE_SIZE = 100;

/** Ten years — the longest window a date filter here has any use for. */
export const MAX_DAYS = 3650;

/**
 * A receipt's lines. Supermarket receipts run to dozens; five hundred is a
 * month's shop on one till roll, and keeps a review submission from being an
 * unbounded loop of writes inside one transaction.
 */
export const MAX_RECEIPT_LINES = 500;
