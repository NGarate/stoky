import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appRouter } from "@/server/trpc/router";
import type { AnyProcedure } from "@trpc/server";
import { withoutComments } from "../utils/without-comments";

/**
 * Which procedures a queued shop may replay, as a recorded decision.
 *
 * The risk this file exists for is drift in both directions. A procedure that
 * quietly gains replay protection and a procedure that quietly loses it look
 * identical from outside — everything still passes, and the queue either
 * double-applies or refuses. So the list is written down here and compared
 * with what the sources actually do, both ways.
 *
 * Importing `appRouter` costs about a third of a second and opens no database
 * connection, which is cheap enough for this tier and far cheaper than asking
 * the same question of a browser.
 */

/** The five writes a shop composes. Everything else is deliberately excluded. */
const REPLAYABLE = [
  "shopping.addItem",
  "shopping.updateItem",
  "shopping.removeItem",
  "inventory.addStock",
  "inventory.consumeStock",
] as const;

/**
 * Excluded on purpose, each for a stated reason.
 *
 * `adjustStock` and `transferStock` are absolute-valued or depend on state at
 * the moment they apply, so replaying one is not the same as applying it once.
 * `product.scanBarcode` makes an outbound Open Food Facts call, and holding a
 * pooled connection across a third-party network request inside a transaction
 * is a hazard the other four do not have. `receipt.upload` carries bytes,
 * which the queue's storage cannot hold.
 */
const NOT_REPLAYABLE = [
  "inventory.adjustStock",
  "inventory.transferStock",
  "product.scanBarcode",
  "product.create",
  "price.recordPrice",
  "receipt.upload",
] as const;

const ROUTERS = join(import.meta.dir, "../../server/trpc/routers");

function routerSource(path: string): string {
  return readFileSync(join(ROUTERS, `${path.split(".")[0]}.ts`), "utf8");
}

function inputSchema(path: string) {
  // Flat and dotted at runtime, nested in the type. The double cast is the
  // honest way to say "I know the runtime shape and the type does not".
  const procedures = appRouter._def.procedures as unknown as Record<
    string,
    AnyProcedure
  >;
  const procedure = procedures[path];
  expect(procedure, `${path} is not a procedure`).toBeDefined();
  const inputs = (procedure as unknown as { _def: { inputs: unknown[] } })._def
    .inputs;
  return inputs[0] as { safeParse: (value: unknown) => { success: boolean } };
}

const VALID_KEY = "3f1a9d1e-4c2b-4a5e-9d3f-2b7c8e1a4f60";

describe("the procedures a queued shop can replay", () => {
  for (const path of REPLAYABLE) {
    it(`${path} requires a well-formed key`, () => {
      const schema = inputSchema(path);
      expect(schema.safeParse({ idempotencyKey: "not-a-uuid" }).success).toBe(
        false,
      );
    });

    it(`${path} goes through withReplay`, () => {
      const source = routerSource(path);
      const name = path.split(".")[1] as string;
      const body = source.slice(source.indexOf(`  ${name}:`));
      expect(body).toContain("withReplay(ctx, {");
    });

    it(`${path} supplies a procedure name, ids and a re-read`, () => {
      const source = routerSource(path);
      const name = path.split(".")[1] as string;
      const start = source.indexOf(`  ${name}:`);
      const body = source.slice(start, source.indexOf("\n  }),", start));

      // Without `reread` a replay cannot answer; without `ids` it has nothing
      // to answer from; without `procedure` a key could be pointed at another.
      expect(body).toContain(`procedure: "${path}"`);
      expect(body).toContain("ids:");
      expect(body).toContain("reread:");
    });
  }
});

describe("the procedures that must not carry a key", () => {
  for (const path of NOT_REPLAYABLE) {
    it(`${path} does not let one reach the database`, () => {
      const schema = inputSchema(path);
      const parsed = schema.safeParse({
        idempotencyKey: VALID_KEY,
        composedByUserId: "clzzzzzzzzzzzzzzzzzzzzzzz",
      }) as { success: boolean; data?: Record<string, unknown> };

      // Zod strips unknown keys rather than rejecting them, and stripping is
      // the property that matters: two of these resolvers spread their input
      // straight into a Prisma `data` argument, where an extra field is a
      // runtime error no type would have caught.
      if (parsed.success) {
        expect(parsed.data).not.toHaveProperty("idempotencyKey");
        expect(parsed.data).not.toHaveProperty("composedByUserId");
      }
    });
  }
});

describe("the list and the sources agree", () => {
  it("finds no replayable procedure the list does not name", () => {
    const found: string[] = [];

    for (const file of ["inventory.ts", "shopping.ts"]) {
      const source = withoutComments(readFileSync(join(ROUTERS, file), "utf8"));
      for (const match of source.matchAll(/procedure: "([\w.]+)"/g)) {
        found.push(match[1] as string);
      }
    }

    expect(found.sort()).toEqual([...REPLAYABLE].sort());
  });

  it("finds withReplay in exactly the two routers that should hold it", () => {
    // Comments are stripped before the scan, so a comment that names the
    // helper — or spells its whole call syntax out — can neither hide a
    // router from this list nor falsely add one. Call syntax rather than the
    // bare word stays as the pattern: it is what distinguishes a use from a
    // string that merely contains the name.
    const holders = ["auth", "household", "inventory", "location", "price",
      "product", "receipt", "shopping", "store"]
      .filter((name) =>
        withoutComments(
          readFileSync(join(ROUTERS, `${name}.ts`), "utf8"),
        ).includes("withReplay("),
      );

    expect(holders).toEqual(["inventory", "shopping"]);
  });
});
