import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withoutComments } from "../utils/without-comments";

/**
 * Every caller-supplied id that names a household-scoped row must be looked up
 * against the household before it is written.
 *
 * This is the repeatable half of the Phase 7 review, and it exists because the
 * review found the same defect **three times in one afternoon**:
 *
 * - `receipt.confirmAll` updated `ReceiptItem` rows by bare id, so a receipt
 *   you own plus line ids you do not rewrote another household's receipt;
 * - `consumeStock`, `adjustStock` and `transferStock` wrote `locationId`
 *   unchecked, while `addStock` beside them had always checked it;
 * - `receipt.upload` wrote `storeId` unchecked, while `price.recordPrice`
 *   verified the identical field two files away.
 *
 * Nobody wrote it wrong twice. Each was written by copying a sibling that
 * happened not to have the check, which is why an audit finds them and a
 * convention does not: the convention *was* being followed, from the wrong
 * example. `ISSUES.md` SEC-1 is the first of the family and rated it HIGH.
 *
 * The rule enforced here is deliberately crude — a procedure that accepts one
 * of these fields must contain a lookup for it somewhere in its own body — and
 * crude is the point. It cannot tell a correct check from a careless one, so it
 * is not a proof of isolation; it is a tripwire on the shape of the mistake
 * that has actually been made here, four times.
 *
 * A new exemption is a conversation, not a line: write the reason.
 */

const ROUTERS = join(import.meta.dir, "..", "..", "server", "trpc", "routers");
const VALIDATIONS = join(import.meta.dir, "..", "..", "lib", "validations");

/**
 * The shared Zod schemas, flattened into one string.
 *
 * Without this the scan has a silent blind spot exactly where the defects were:
 * the stock procedures declare their input as `addStockSchema` and friends
 * rather than inline, so a scan looking for `locationId: z.` in the router finds
 * nothing and skips the check — reporting a pass it has not earned. Found by
 * removing a guard and watching this file stay green, which is the only way
 * that class of hole is ever found.
 */
const SCHEMAS: Record<string, string> = Object.fromEntries(
  readdirSync(VALIDATIONS)
    .filter((name) => name.endsWith(".ts"))
    .flatMap((name) => {
      const source = readFileSync(join(VALIDATIONS, name), "utf8");
      // Every schema const, exported or not. The unexported ones matter most:
      // `adjustStockSchema` extends `stockMovement`, and `locationId` is
      // declared in `stockMovement` — so a scan that only reads exported
      // schemas finds nothing and skips the check it exists to make.
      // No `m` flag, deliberately. With it, the `$` in the lookahead means end
      // of *line*, so every schema was truncated at its first one — which is
      // how this scan came to report a clean pass while a real guard was
      // removed. Found by removing one and watching it stay green.
      return [
        ...source.matchAll(
          /(?:^|\n)(?:export )?const (\w+)\s*=\s*([\s\S]*?)(?=\n(?:export )?(?:const|type|function|interface) |$)/g,
        ),
      ].map((match) => [match[1] as string, match[2] as string] as const);
    }),
);

/**
 * A procedure's input surface: its own source, plus every schema it names and
 * every schema *those* name, followed transitively.
 *
 * One level is not enough and that was measured, not guessed: removing a real
 * guard left this file green because `adjustStockSchema` extends
 * `stockMovement`, which is where the field actually lives.
 */
function inputSurface(body: string): string {
  const seen = new Set<string>();
  const queue = [...body.matchAll(/\b(\w+)\b/g)].map((m) => m[1] as string);
  let surface = body;

  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);

    const schema = SCHEMAS[name];
    if (!schema) continue;

    surface += `\n${schema}`;
    for (const match of schema.matchAll(/\b(\w+)\b/g)) {
      queue.push(match[1] as string);
    }
  }

  return surface;
}

/**
 * The input fields that name a row belonging to a household — or, for
 * `sessionId`, to an account.
 *
 * `productId` is included even though most procedures check it, because the two
 * receipt confirm procedures did not — and that is exactly the asymmetry the
 * review turned on.
 *
 * `parentId` (the location tree) was added after the 2026-10-12 review found
 * `location.create` could lose its parent check with this file still green.
 * It catches that one; in `location.update`, which also looks up its own
 * `id`, the existence check satisfies the same pattern, so there the field
 * check is vacuous and `integration/cross-household.test.ts` is the guard.
 *
 * **Not here, deliberately: the primary `id`.** Every update, delete and
 * getById takes one, and the only pattern that would fit them all — "the body
 * mentions `householdId`" — is true of nearly every body for unrelated reasons
 * (the create data, another lookup), so it would pass with the guard gone and
 * report a pass it had not earned. Primary ids are covered behaviourally, in
 * `integration/cross-household.test.ts` and the isolation suites beside it.
 */
const SCOPED: Record<string, RegExp> = {
  storeId: /store\.(findFirst|findUnique)|assertOwnStore|assertStoreIsOurs/,
  locationId: /storageLocation\.(findFirst|findUnique)|assertOwnLocation/,
  parentId: /storageLocation\.(findFirst|findUnique)|assertOwnLocation/,
  consumeFromLocationId:
    /storageLocation\.(findFirst|findUnique)|assertOwnLocation/,
  fromLocationId: /storageLocation\.(findFirst|findUnique)|assertOwnLocation/,
  toLocationId: /storageLocation\.(findFirst|findUnique)|assertOwnLocation/,
  productId: /product\.(findFirst|findUnique)|assertOwnProduct/,
  shoppingListId: /shoppingList\.(findFirst|findUnique)/,
  receiptItemId: /receiptItem\.(findFirst|findUnique|findMany)/,
  // Not a household's row but an account's: a `Session` id from
  // `auth.listSessions` (D143). Scoped by the caller's own `userId` in the
  // very filter that uses it, so another account's id matches nothing — the
  // object that names `input.sessionId` must also name `userId`.
  sessionId:
    /\{[^{}]*\buserId\b[^{}]*\binput\.sessionId\b[^{}]*\}|\{[^{}]*\binput\.sessionId\b[^{}]*\buserId\b[^{}]*\}/,
};

// Bodies are stripped of comments before they are tested against `SCOPED`,
// so prose satisfies nothing: a bare identifier in `SCOPED` matches
// `// (see assertOwnProduct above)` as readily as a real call — most of the
// NOT_FOUND blocks receipt.ts grew during the review carry that phrase
// (confirmAll's per-line refusal words it differently) — and with the
// comments in place this file stayed green after the real
// `assertOwnProduct(...)` call was deleted from `confirmItem`. The stripper
// itself, its string-literal handling and its stated limits live in
// `../utils/without-comments`, shared with `replayable.test.ts`.

/**
 * Procedures that take one of these fields and legitimately do not look it up,
 * with the reason. A path with no reason is indistinguishable from one nobody
 * looked at.
 *
 * Note what they have in common: every one puts the household beside the id
 * before anything depends on it, so an id that is not yours narrows to nothing
 * instead of leaking. Not every one is a read: seven are, with the household
 * filter in their own query, but `product.update` and `product.delete` are
 * writes that resolve the id by id and `householdId` together before they
 * write anything. The rule this file enforces is about ids that get *written*
 * without that lookup, where no later filter can save you — which is the line
 * all four defects crossed.
 */
const ALLOWED: Record<string, string> = {
  "product.getById":
    "the lookup IS the procedure — findFirst on {id, householdId} is its whole body",
  "product.update":
    "resolves the product against the household before writing, by id and householdId together",
  "product.delete":
    "resolves the product against the household by id and householdId together before the reference counts and the delete; those later queries key on the bare id, but only after that lookup has refused a foreign one",
  "inventory.getStockHistory":
    "a read: refuses a foreign productId with a household-scoped findFirst, then reads the ledger by that proven id",
  "inventory.getStockOverview":
    "a read: the SQL carries the household filter, so a foreign locationId narrows to nothing",
  "inventory.getExpiringItems":
    "a read: the household filter is passed beside the locationId, so a foreign id narrows within the caller's own household",
  "inventory.getExpiredItems": "a read, as above",
  "price.getLatestPrices":
    "a read: filters on product.householdId as well as the id",
  "price.getHistory":
    "a read: both ids sit beside a product.householdId filter in the same where clause",
};

/** Every procedure in a router file, with the source between it and the next. */
function proceduresIn(file: string, source: string) {
  const router = file.replace(/\.ts$/, "");
  const starts = [
    ...source.matchAll(
      /^ {2}([a-zA-Z][a-zA-Z0-9]*): (public|protected|household|write|admin)Procedure/gm,
    ),
  ];

  return starts.map((match, index) => ({
    name: `${router}.${match[1]}`,
    body: source.slice(
      match.index,
      index + 1 < starts.length ? starts[index + 1]!.index : source.length,
    ),
  }));
}

describe("a caller-supplied id is looked up before it is written", () => {
  const files = readdirSync(ROUTERS).filter((name) => name.endsWith(".ts"));

  it("finds the routers, so the checks below are not vacuous", () => {
    // The failure this guards against is the scan quietly matching nothing —
    // which reports as a pass and proves the opposite of what it claims.
    expect(files.length).toBeGreaterThan(5);

    const total = files.flatMap((file) =>
      proceduresIn(file, readFileSync(join(ROUTERS, file), "utf8")),
    );
    expect(total.length).toBeGreaterThan(50);
  });

  it("has no exemption for a procedure that no longer exists", () => {
    // A dead ALLOWED key is worse than useless: the scan only ever *consults*
    // ALLOWED by key (`if (ALLOWED[name]) continue`), so a key naming a
    // renamed or deleted procedure silently exempts nothing and fails
    // nothing — which is how `price.getPriceHistory` and `price.compareStores`
    // sat here naming procedures that never existed. Every exemption must
    // name a real procedure, so removing one forces the exemption to go too.
    const real = new Set(
      files.flatMap((file) =>
        proceduresIn(file, readFileSync(join(ROUTERS, file), "utf8")).map(
          (p) => p.name,
        ),
      ),
    );
    const dead = Object.keys(ALLOWED).filter((name) => !real.has(name));
    expect(dead).toEqual([]);
  });

  it("checks every household-scoped id a procedure accepts", () => {
    const unchecked: string[] = [];

    for (const file of files) {
      const source = readFileSync(join(ROUTERS, file), "utf8");

      for (const { name, body } of proceduresIn(file, source)) {
        if (ALLOWED[name]) continue;

        const surface = inputSurface(body);
        const code = withoutComments(body);

        for (const [field, lookup] of Object.entries(SCOPED)) {
          // Only the fields this procedure actually accepts from the caller —
          // declared inline or in a shared schema it names.
          const accepts = new RegExp(`\\b${field}: z\\.`).test(surface);
          if (!accepts) continue;
          if (lookup.test(code)) continue;

          unchecked.push(`${name} accepts ${field} and never looks it up`);
        }
      }
    }

    expect(unchecked).toEqual([]);
  });
});
