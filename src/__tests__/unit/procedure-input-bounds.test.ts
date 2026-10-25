import { describe, it, expect } from "bun:test";
import type { AnyProcedure } from "@trpc/server";
import { z } from "zod";
import { appRouter } from "@/server/trpc/router";
import {
  MAX_ID_LENGTH,
  MAX_MIME_TYPE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_UNIT_LENGTH,
} from "@/lib/validations/bounds";

/**
 * Every string and every array any procedure accepts has a maximum.
 *
 * The 2026-10-12 review found the opposite almost everywhere: names, notes,
 * addresses, units, barcodes, currencies and ids were bare `z.string()`, so a
 * self-registered account could store about 14 MB per field per call on the
 * disk every household shares, and the sign-in address became a security-log
 * line of whatever size was sent. The bounds now live in
 * `src/lib/validations/bounds.ts`; this is what keeps a new field from
 * arriving without one.
 *
 * **It walks the parsers tRPC actually runs**, not the files in
 * `src/lib/validations/`. Half the inputs here are declared beside their
 * procedure (`transferStock`, `receipt.upload`, every `{ id }`), which a scan of
 * the shared schemas cannot see, and a schema that is exported but not used
 * proves nothing about one that is.
 *
 * **A wrapper this walk does not understand is a failure, not a pass.** A
 * future `z.record()` or `z.lazy()` would otherwise be skipped silently, and
 * a tripwire that reports a pass it has not earned is the failure
 * `tenant-scoped-ids.test.ts` documents finding twice.
 *
 * What counts as bounded: a string with `.max()` or `.length()`, or a
 * `.uuid()` — a fixed-length pattern. **Not `.cuid()`**: Zod 4's cuid pattern
 * is `c` followed by six or more lowercase letters and digits, and accepts a
 * megabyte of them (Zod 3's took eight or more of anything). Not
 * `.regex()` either, which this walk cannot read the length out of; a regex
 * that does bound the length states the bound as well.
 *
 * Importing `appRouter` opens no database connection (see
 * `replayable.test.ts`), which is why this is a unit test.
 */

/** What every Zod 4 schema keeps under `_zod.def`, as far as this walk reads it. */
type Def = Record<string, unknown> & {
  type: string;
  format?: string;
  checks?: { _zod: { def: { check: string; format?: string } } }[];
};

function defOf(schema: z.ZodType): Def {
  return schema._zod.def as unknown as Def;
}

/** The kinds of check, on a string or an array, that set a maximum. */
function hasMaximum(def: Def): boolean {
  return (def.checks ?? []).some(
    ({ _zod: { def: check } }) =>
      check.check === "max_length" ||
      check.check === "length_equals" ||
      (check.check === "string_format" && check.format === "uuid"),
  );
}

/** Types that cannot carry an unbounded amount of caller data. */
const LEAVES = new Set([
  "number",
  "boolean",
  "date",
  "enum",
  "literal",
  "void",
  "undefined",
  "null",
]);

/** The paths under `schema` that accept an unbounded string or array. */
function unboundedPaths(schema: z.ZodType, path: string): string[] {
  const def = defOf(schema);

  if (LEAVES.has(def.type)) return [];

  switch (def.type) {
    case "string":
      // `z.uuid()` is a string whose own format is the bound; `.max()` and
      // `.uuid()` on a `z.string()` are checks attached to it.
      return def.format === "uuid" || hasMaximum(def) ? [] : [path];

    case "array": {
      const own = hasMaximum(def) ? [] : [path];
      return [...own, ...unboundedPaths(def.element as z.ZodType, `${path}[]`)];
    }

    case "object": {
      const shape = def.shape as Record<string, z.ZodType>;
      const fields = Object.entries(shape).flatMap(([key, value]) =>
        unboundedPaths(value, path ? `${path}.${key}` : key),
      );
      // `.passthrough()` keeps keys nobody declared (Zod 4 spells it as a
      // catchall of `unknown`), and any other `.catchall()` takes them under
      // its own schema: either is a way round every bound above it. No
      // catchall strips them, and `never` refuses them.
      const catchall = def.catchall as z.ZodType | undefined;
      const catchallType = catchall ? defOf(catchall).type : "never";
      const extra =
        catchallType === "unknown" || catchallType === "any"
          ? [`${path || "(root)"}.* (passthrough)`]
          : catchallType === "never"
            ? []
            : unboundedPaths(catchall as z.ZodType, `${path || "(root)"}.*`);
      return [...fields, ...extra];
    }

    case "optional":
    case "nullable":
    case "nonoptional":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
      return unboundedPaths(def.innerType as z.ZodType, path);

    // A `.transform()` is a pipe into one of these: it is handed what the
    // schema before it already accepted, never the caller's input.
    case "transform":
      return [];

    case "pipe":
      return [
        ...unboundedPaths(def.in as z.ZodType, path),
        ...unboundedPaths(def.out as z.ZodType, path),
      ];

    case "intersection":
      return [
        ...unboundedPaths(def.left as z.ZodType, path),
        ...unboundedPaths(def.right as z.ZodType, path),
      ];

    // A discriminated union is a union with a discriminator in Zod 4.
    case "union":
      return (def.options as z.ZodType[]).flatMap((option) =>
        unboundedPaths(option, path),
      );

    default:
      return [`${path || "(root)"} (${def.type}: not understood by this walk)`];
  }
}

const procedures = appRouter._def.procedures as unknown as Record<
  string,
  AnyProcedure
>;

function inputsOf(path: string): z.ZodType[] {
  const procedure = procedures[path];
  expect(procedure, `${path} is not a procedure`).toBeDefined();
  return (procedure as unknown as { _def: { inputs: z.ZodType[] } })._def
    .inputs;
}

describe("every procedure's input is bounded", () => {
  it("finds the procedures to walk", () => {
    // A walk over nothing passes. Sixty-odd procedures today; this only
    // guards against the lookup itself breaking and returning none.
    expect(Object.keys(procedures).length).toBeGreaterThan(50);
  });

  for (const path of Object.keys(procedures).sort()) {
    it(`${path} takes no unbounded string or array`, () => {
      const unbounded = inputsOf(path).flatMap((input) =>
        unboundedPaths(input, ""),
      );
      expect(unbounded).toEqual([]);
    });
  }
});

describe("the walk itself", () => {
  // The walk is the test, so it gets tests: each of these is a shape it
  // would otherwise have waved through.
  it("names an unbounded field however deeply it is wrapped", () => {
    const schema = z
      .object({
        ok: z.string().max(3),
        list: z.array(z.object({ note: z.string().optional() })).max(5),
        either: z.union([z.string().max(1), z.string()]),
        tagged: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("a"), name: z.string().nullish() }),
        ]),
        cuid: z.string().cuid(),
      })
      .and(z.object({ joined: z.string().default("x") }))
      .refine(() => true);

    expect(unboundedPaths(schema, "").sort()).toEqual(
      ["cuid", "either", "joined", "list[].note", "tagged.name"].sort(),
    );
  });

  it("names an array without a maximum, and keys a passthrough object keeps", () => {
    expect(
      unboundedPaths(z.object({ ids: z.array(z.string().max(1)) }), ""),
    ).toEqual(["ids"]);
    expect(unboundedPaths(z.object({}).passthrough(), "")).toEqual([
      "(root).* (passthrough)",
    ]);
  });

  it("refuses to pass a type it does not understand", () => {
    expect(
      unboundedPaths(
        z.object({ blob: z.record(z.string(), z.string().max(1)) }),
        "",
      ),
    ).toEqual(["blob (record: not understood by this walk)"]);
  });
});

describe("the bounds on inputs declared beside their procedure", () => {
  // The walk proves a maximum exists; these pin what it is, for the fields
  // no shared schema owns.
  const accepts = (path: string, value: unknown) =>
    inputsOf(path)[0].safeParse(value).success;

  const transfer = {
    productId: "p",
    quantity: 1,
    unit: "unidad",
    fromLocationId: "a",
    toLocationId: "b",
  };

  it("bounds a transfer's note, unit and ids", () => {
    expect(
      accepts("inventory.transferStock", {
        ...transfer,
        note: "n".repeat(MAX_NOTE_LENGTH),
      }),
    ).toBe(true);
    expect(
      accepts("inventory.transferStock", {
        ...transfer,
        note: "n".repeat(MAX_NOTE_LENGTH + 1),
      }),
    ).toBe(false);
    expect(
      accepts("inventory.transferStock", {
        ...transfer,
        unit: "u".repeat(MAX_UNIT_LENGTH + 1),
      }),
    ).toBe(false);
    expect(
      accepts("inventory.transferStock", {
        ...transfer,
        toLocationId: "b".repeat(MAX_ID_LENGTH + 1),
      }),
    ).toBe(false);
  });

  it("bounds an upload's declared type before the allowlist is consulted", () => {
    const upload = { fileBase64: "" };
    expect(
      accepts("receipt.upload", { ...upload, mimeType: "image/jpeg" }),
    ).toBe(true);
    expect(
      accepts("receipt.upload", {
        ...upload,
        mimeType: "x".repeat(MAX_MIME_TYPE_LENGTH + 1),
      }),
    ).toBe(false);
  });

  it("bounds the ids every lookup by id takes", () => {
    for (const path of [
      "product.getById",
      "store.delete",
      "location.delete",
      "shopping.getById",
    ]) {
      expect(accepts(path, { id: "c".repeat(MAX_ID_LENGTH) })).toBe(true);
      expect(accepts(path, { id: "c".repeat(MAX_ID_LENGTH + 1) })).toBe(false);
    }
    expect(
      accepts("receipt.getStatus", {
        receiptId: "r".repeat(MAX_ID_LENGTH + 1),
      }),
    ).toBe(false);
  });
});
