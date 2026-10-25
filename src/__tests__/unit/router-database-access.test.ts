import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Where a router is allowed to get its database client.
 *
 * Phase 4 wraps the writes a shop composes in one transaction each. A resolver
 * that reaches for the `@/lib/prisma` singleton instead of `ctx.db` runs
 * *outside* that transaction — its write commits on its own, and a rollback
 * leaves it behind. That is the worst failure mode of the replay design, it
 * produces no type error, and no runtime test would notice until the day
 * something rolls back.
 *
 * So it is checked as a fact about the source. `inventory` and `shopping` hold
 * every procedure a queued shop can replay, and they are the two that must not
 * import the singleton. The rest are listed as still importing it rather than
 * merely "allowed to", so converting one and forgetting this file fails here
 * instead of drifting quietly.
 */

const ROUTERS = join(import.meta.dir, "../../server/trpc/routers");

/** Holds a replayable procedure. Must take its client from the context. */
const FROM_CONTEXT = ["inventory.ts", "shopping.ts"];

const SINGLETON_IMPORT = /from\s+["']@\/lib\/prisma["']/;

function source(file: string): string {
  return readFileSync(join(ROUTERS, file), "utf8");
}

describe("routers that hold a replayable procedure", () => {
  for (const file of FROM_CONTEXT) {
    it(`${file} does not import the prisma singleton`, () => {
      expect(SINGLETON_IMPORT.test(source(file))).toBe(false);
    });

    it(`${file} reaches the database only through ctx.db`, () => {
      // `@prisma/client` type imports are fine — they carry no client.
      const bareUsage = source(file).match(/(?<![.\w])prisma\.\w/g) ?? [];
      expect(bareUsage).toEqual([]);
    });

    it(`${file} actually uses ctx.db, so the check above is not vacuous`, () => {
      expect(source(file)).toContain("ctx.db.");
    });
  }
});

describe("the routers not yet converted", () => {
  it("are exactly the ones this file expects", () => {
    const all = readdirSync(ROUTERS).filter((name) => name.endsWith(".ts"));
    const stillImporting = all
      .filter((file) => SINGLETON_IMPORT.test(source(file)))
      .sort();

    // Listed rather than ignored: converting a router and not updating this
    // list fails here, which is the reminder to decide whether it now needs
    // the same guarantee.
    expect(stillImporting).toEqual(["receipt.ts"]);
  });
});
