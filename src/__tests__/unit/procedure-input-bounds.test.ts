import { describe, it, expect } from "bun:test";
import type { AnyProcedure } from "@trpc/server";
import { z, ZodFirstPartyTypeKind, type ZodTypeAny } from "zod";
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
 * `.uuid()` — a fixed-length pattern. **Not `.cuid()`**: Zod 3's cuid pattern
 * is `c` followed by eight or more of anything, and accepted a megabyte. Not
 * `.regex()` either, which this walk cannot read the length out of; a regex
 * that does bound the length states the bound as well.
 *
 * Importing `appRouter` opens no database connection (see
 * `replayable.test.ts`), which is why this is a unit test.
 */

type Def = Record<string, unknown> & { typeName: ZodFirstPartyTypeKind };

function defOf(schema: ZodTypeAny): Def {
  return schema._def as Def;
}

/** Types that cannot carry an unbounded amount of caller data. */
const LEAVES = new Set<ZodFirstPartyTypeKind>([
  ZodFirstPartyTypeKind.ZodNumber,
  ZodFirstPartyTypeKind.ZodBoolean,
  ZodFirstPartyTypeKind.ZodDate,
  ZodFirstPartyTypeKind.ZodEnum,
  ZodFirstPartyTypeKind.ZodNativeEnum,
  ZodFirstPartyTypeKind.ZodLiteral,
  ZodFirstPartyTypeKind.ZodVoid,
  ZodFirstPartyTypeKind.ZodUndefined,
  ZodFirstPartyTypeKind.ZodNull,
]);

/** The paths under `schema` that accept an unbounded string or array. */
function unboundedPaths(schema: ZodTypeAny, path: string): string[] {
  const def = defOf(schema);

  if (LEAVES.has(def.typeName)) return [];

  switch (def.typeName) {
    case ZodFirstPartyTypeKind.ZodString: {
      const checks = def.checks as { kind: string }[];
      const bounded = checks.some(
        (check) => check.kind === "max" || check.kind === "length" || check.kind === "uuid",
      );
      return bounded ? [] : [path];
    }

    case ZodFirstPartyTypeKind.ZodArray: {
      const own = def.maxLength || def.exactLength ? [] : [path];
      return [...own, ...unboundedPaths(def.type as ZodTypeAny, `${path}[]`)];
    }

    case ZodFirstPartyTypeKind.ZodObject: {
      const shape = (def.shape as () => Record<string, ZodTypeAny>)();
      const fields = Object.entries(shape).flatMap(([key, value]) =>
        unboundedPaths(value, path ? `${path}.${key}` : key),
      );
      // `.passthrough()` keeps keys nobody declared, and a `.catchall()`
      // takes them under its own schema: either is a way round every bound
      // above it.
      const catchall = def.catchall as ZodTypeAny;
      const extra =
        def.unknownKeys === "passthrough"
          ? [`${path || "(root)"}.* (passthrough)`]
          : defOf(catchall).typeName === ZodFirstPartyTypeKind.ZodNever
            ? []
            : unboundedPaths(catchall, `${path || "(root)"}.*`);
      return [...fields, ...extra];
    }

    case ZodFirstPartyTypeKind.ZodEffects:
      return unboundedPaths(def.schema as ZodTypeAny, path);

    case ZodFirstPartyTypeKind.ZodOptional:
    case ZodFirstPartyTypeKind.ZodNullable:
    case ZodFirstPartyTypeKind.ZodDefault:
    case ZodFirstPartyTypeKind.ZodCatch:
    case ZodFirstPartyTypeKind.ZodReadonly:
      return unboundedPaths(def.innerType as ZodTypeAny, path);

    case ZodFirstPartyTypeKind.ZodBranded:
      return unboundedPaths(def.type as ZodTypeAny, path);

    case ZodFirstPartyTypeKind.ZodPipeline:
      return [
        ...unboundedPaths(def.in as ZodTypeAny, path),
        ...unboundedPaths(def.out as ZodTypeAny, path),
      ];

    case ZodFirstPartyTypeKind.ZodIntersection:
      return [
        ...unboundedPaths(def.left as ZodTypeAny, path),
        ...unboundedPaths(def.right as ZodTypeAny, path),
      ];

    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
      return (def.options as ZodTypeAny[]).flatMap((option) => unboundedPaths(option, path));

    default:
      return [`${path || "(root)"} (${def.typeName}: not understood by this walk)`];
  }
}

const procedures = appRouter._def.procedures as unknown as Record<string, AnyProcedure>;

function inputsOf(path: string): ZodTypeAny[] {
  const procedure = procedures[path];
  expect(procedure, `${path} is not a procedure`).toBeDefined();
  return (procedure as unknown as { _def: { inputs: ZodTypeAny[] } })._def.inputs;
}

describe("every procedure's input is bounded", () => {
  it("finds the procedures to walk", () => {
    // A walk over nothing passes. Sixty-odd procedures today; this only
    // guards against the lookup itself breaking and returning none.
    expect(Object.keys(procedures).length).toBeGreaterThan(50);
  });

  for (const path of Object.keys(procedures).sort()) {
    it(`${path} takes no unbounded string or array`, () => {
      const unbounded = inputsOf(path).flatMap((input) => unboundedPaths(input, ""));
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
    expect(unboundedPaths(z.object({ ids: z.array(z.string().max(1)) }), "")).toEqual(["ids"]);
    expect(unboundedPaths(z.object({}).passthrough(), "")).toEqual(["(root).* (passthrough)"]);
  });

  it("refuses to pass a type it does not understand", () => {
    expect(unboundedPaths(z.object({ blob: z.record(z.string().max(1)) }), "")).toEqual([
      "blob (ZodRecord: not understood by this walk)",
    ]);
  });
});

describe("the bounds on inputs declared beside their procedure", () => {
  // The walk proves a maximum exists; these pin what it is, for the fields
  // no shared schema owns.
  const accepts = (path: string, value: unknown) =>
    (inputsOf(path)[0] as ZodTypeAny).safeParse(value).success;

  const transfer = {
    productId: "p",
    quantity: 1,
    unit: "unidad",
    fromLocationId: "a",
    toLocationId: "b",
  };

  it("bounds a transfer's note, unit and ids", () => {
    expect(accepts("inventory.transferStock", { ...transfer, note: "n".repeat(MAX_NOTE_LENGTH) })).toBe(true);
    expect(accepts("inventory.transferStock", { ...transfer, note: "n".repeat(MAX_NOTE_LENGTH + 1) })).toBe(false);
    expect(accepts("inventory.transferStock", { ...transfer, unit: "u".repeat(MAX_UNIT_LENGTH + 1) })).toBe(false);
    expect(accepts("inventory.transferStock", { ...transfer, toLocationId: "b".repeat(MAX_ID_LENGTH + 1) })).toBe(false);
  });

  it("bounds an upload's declared type before the allowlist is consulted", () => {
    const upload = { fileBase64: "" };
    expect(accepts("receipt.upload", { ...upload, mimeType: "image/jpeg" })).toBe(true);
    expect(accepts("receipt.upload", { ...upload, mimeType: "x".repeat(MAX_MIME_TYPE_LENGTH + 1) })).toBe(false);
  });

  it("bounds the ids every lookup by id takes", () => {
    for (const path of ["product.getById", "store.delete", "location.delete", "shopping.getById"]) {
      expect(accepts(path, { id: "c".repeat(MAX_ID_LENGTH) })).toBe(true);
      expect(accepts(path, { id: "c".repeat(MAX_ID_LENGTH + 1) })).toBe(false);
    }
    expect(accepts("receipt.getStatus", { receiptId: "r".repeat(MAX_ID_LENGTH + 1) })).toBe(false);
  });
});
