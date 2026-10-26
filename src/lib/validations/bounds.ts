/**
 * The outer edges of what a household could mean, shared by every schema.
 *
 * Not product rules — nobody's flour is checked against these — but the line
 * past which a number is a mistake or an attack rather than an amount:
 *
 * - **Infinity.** Zod 3's `z.number()` accepted it — `.positive()` too — and
 *   superjson carries it across the wire intact, so `quantity: Infinity`
 *   passed validation, and a `double precision` column will store it. One
 *   such row and every sum over the ledger is Infinity. Zod 4's `z.number()`
 *   refuses it; the schemas still say `.finite()`, which costs nothing and
 *   does not depend on a library default.
 * - **Unbounded page sizes.** `product.searchByName` interpolates its `limit`
 *   into `LIMIT ${…}`: `-1` was a Postgres error that surfaced as a 500, and a
 *   billion asked the database for every row it had.
 * - **Unbounded day windows.** `price.getPriceHistory` subtracts `days` from
 *   today; `1e12` is an Invalid Date that reaches Prisma.
 * - **Unbounded search strings**, which go into `pg_trgm` similarity and an
 *   `ILIKE` on every keystroke.
 * - **Unbounded stored text.** Every name, note, address, unit, barcode and
 *   currency was a bare `z.string()`, and every Prisma `String` is a Postgres
 *   `text`, so the only ceiling on one field was the 15 MiB request body. Open
 *   registration makes anybody an `OWNER` of a household of their own, and a
 *   loop of `product.create` calls with a 14 MB name each filled the disk every
 *   household on the instance shares. Unauthenticated, a 10 MB address passed
 *   `loginSchema` and became a 10 MB line in the security log. Both measured
 *   in the 2026-10-12 review, with the repository's own schemas.
 * - **Unbounded ids**, for the same reason one level down: an id is a string a
 *   caller chooses, it is looked up, logged and — in the replay table — stored.
 *   `.cuid()` is not a bound: Zod 4's pattern is `c` and then six or more
 *   lowercase letters and digits (Zod 3's took eight or more of anything), so
 *   a megabyte of them that starts with `c` is a cuid.
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

/*
 * Lengths of stored text. Application-level only, on purpose: a `VarChar(n)`
 * migration would fail on the upgrade of any instance already holding a longer
 * value, and every write reaches the database through these schemas. A row
 * stored before the bound still displays; saving it again means shortening it.
 */

/** RFC 5321 §4.5.3.1: a forward-path is at most 256 octets, brackets included. */
export const MAX_EMAIL_LENGTH = 254;

/**
 * A product, brand, category, store, location, list, household or person —
 * anything a row is called. Two hundred because Open Food Facts names and
 * receipt lines run long — "Leche semidesnatada sin lactosa enriquecida con
 * calcio y vitamina D, brik 6 x 1 L" is eighty-one characters — and a name a
 * form refuses for being real is the bug a lower number files.
 */
export const MAX_NAME_LENGTH = 200;

/** A note on a movement, the reason for a correction, a shop's address. */
export const MAX_NOTE_LENGTH = 1000;

/** "unidad", "g", "paquete de 6". Thirty-two is a phrase, not a unit. */
export const MAX_UNIT_LENGTH = 32;

/**
 * A barcode as a product carries it — **not** a GTIN pattern. A shop's own
 * label, a Code 128 shelf code and a hand-typed internal number are all
 * barcodes somebody keeps, and only the Open Food Facts lookup
 * (`productByBarcodeSchema`) needs the digits-only form.
 */
export const MAX_BARCODE_LENGTH = 64;

/**
 * An id a caller names. Every model mints a cuid, twenty-five characters, but
 * the bound is a length rather than `.cuid()`: older rows and test fixtures
 * use other shapes, and a length stops the same abuse without guessing at the
 * id strategy.
 */
export const MAX_ID_LENGTH = 64;

/** RFC 6838 §4.2: a type and a subtype of at most 127 characters each. */
export const MAX_MIME_TYPE_LENGTH = 255;
