import { describe, it, expect, beforeAll } from "bun:test";
import { prisma } from "@/lib/prisma";

/**
 * ISSUES.md DEBT-5 — the indexes, asserted against the live database.
 *
 * A schema file is a statement of intent; `pg_indexes` is what the planner
 * actually reads. The gap between them is a migration that was written and
 * never applied, or applied on a developer's box and never committed, and
 * neither shows up as a failing test anywhere else — the queries all still
 * return the right rows, just slowly, and only in production where the tables
 * are big enough to notice.
 *
 * So this asserts existence, not speed. A timing assertion would need a table
 * large enough for the planner to prefer an index, which is minutes of seeding
 * per run and a flake on a busy machine; the measurement that justified these
 * indexes is in the commit that added them, taken once at 12,000 rows.
 */

type IndexRow = { tablename: string; indexdef: string };

let indexes: IndexRow[] = [];

/** The column list of an index definition, normalised for comparison. */
function columnsOf(definition: string): string {
  const inside = /\((.*)\)$/.exec(definition)?.[1] ?? "";
  return inside
    .split(",")
    .map((column) => column.trim().replace(/"/g, "").split(" ")[0])
    .join(",");
}

function hasIndex(
  table: string,
  columns: string[],
  options: { unique?: boolean } = {},
): boolean {
  const wanted = columns.join(",");
  return indexes.some(
    (row) =>
      row.tablename === table &&
      columnsOf(row.indexdef) === wanted &&
      (!options.unique || row.indexdef.startsWith("CREATE UNIQUE INDEX")),
  );
}

beforeAll(async () => {
  indexes = await prisma.$queryRaw<IndexRow[]>`
    SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public'
  `;
});

describe("the lookups every screen makes", () => {
  // These are looked up by a specific parent id, so they are selective whatever
  // the size of the household — the case where an index always wins.

  it("finds a product's stock ledger without reading the table", () => {
    // The hottest query in the application: every consume, every transfer and
    // every expiry calculation reads one product's entries, because a batch's
    // remaining quantity cannot be known without the rest of its ledger.
    expect(hasIndex("StockEntry", ["productId"])).toBe(true);
  });

  it("finds a receipt's lines", () => {
    expect(hasIndex("ReceiptItem", ["receiptId"])).toBe(true);
  });

  it("finds a list's items", () => {
    expect(hasIndex("ShoppingItem", ["shoppingListId"])).toBe(true);
  });

  it("finds what a product is already written down for", () => {
    // `getStockOverview` asks this for every product on the page at once, to
    // decide whether the kitchen still offers to add it.
    expect(hasIndex("ShoppingItem", ["productId"])).toBe(true);
  });

  it("finds what is meant to be bought at one shop", () => {
    expect(hasIndex("ShoppingItem", ["storeId"])).toBe(true);
  });

  it("finds a product's price history in date order", () => {
    // Composite rather than two: the history is always read for one product
    // *and* ordered by date, so the second column saves the sort as well.
    expect(hasIndex("PriceRecord", ["productId", "recordedAt"])).toBe(true);
  });

  it("finds a household's receipts newest first", () => {
    expect(hasIndex("Receipt", ["householdId", "createdAt"])).toBe(true);
  });
});

describe("the household scoping", () => {
  // Honest about what these buy: on a single-household instance the household
  // owns the whole table, the planner sequentially scans it whatever exists,
  // and these do nothing for reads. They are here for an instance hosting more
  // than one household, and for the foreign-key checks a delete performs.

  const scoped: [string, string][] = [
    ["Product", "householdId"],
    ["Store", "householdId"],
    ["StorageLocation", "householdId"],
    ["ShoppingList", "householdId"],
    ["User", "householdId"],
  ];

  for (const [table, column] of scoped) {
    it(`${table} is indexed by household`, () => {
      expect(hasIndex(table, [column])).toBe(true);
    });
  }
});

describe("the auth tables", () => {
  // Better Auth reads these on every authenticated request, so they are the
  // hottest lookups in the application once it signs people in.

  it("finds a session by its token, and never two", () => {
    // The cookie carries the token; the row is looked up by it on every read.
    // Unique as well as indexed: two rows answering one token would be one
    // cookie signing in as whichever the planner found first.
    expect(hasIndex("Session", ["token"], { unique: true })).toBe(true);
  });

  it("finds a person's sessions", () => {
    // The device list, ending every session but this one, and the cap on how
    // many a person may hold all start from the user.
    expect(hasIndex("Session", ["userId"])).toBe(true);
  });

  it("finds the expired sessions", () => {
    expect(hasIndex("Session", ["expiresAt"])).toBe(true);
  });

  it("finds a pending verification by what it verifies", () => {
    // A two-step sign-in in progress is looked up by its identifier.
    expect(hasIndex("Verification", ["identifier"])).toBe(true);
  });
});

describe("every foreign key", () => {
  // PostgreSQL indexes a primary key and a unique constraint automatically and
  // a foreign key never — the asymmetry DEBT-5 is about. An unindexed FK also
  // makes deleting the parent scan the child table once per row.

  it("has an index on the referencing column", async () => {
    const unindexed = await prisma.$queryRaw<
      { table: string; column: string }[]
    >`
      SELECT
        source.relname::text AS "table",
        attribute.attname::text AS "column"
      FROM pg_constraint AS constraint_
      JOIN pg_class AS source ON source.oid = constraint_.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = source.relnamespace
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = source.oid
       AND attribute.attnum = constraint_.conkey[1]
      WHERE constraint_.contype = 'f'
        AND namespace.nspname = 'public'
        AND array_length(constraint_.conkey, 1) = 1
        AND NOT EXISTS (
          SELECT 1 FROM pg_index AS index_
          WHERE index_.indrelid = constraint_.conrelid
            AND index_.indkey[0] = constraint_.conkey[1]
        )
      ORDER BY 1, 2
    `;

    expect(unindexed).toEqual([]);
  });
});
