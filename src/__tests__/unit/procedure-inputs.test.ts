import { describe, it, expect } from "bun:test";
import { appRouter } from "@/server/trpc/router";
import { MAX_PASSWORD_LENGTH } from "@/lib/validations/password";

/**
 * Every mutation declares what it accepts.
 *
 * A procedure with no `.input()` has no parser, and tRPC then hands the
 * resolver whatever body arrived — a multipart form from another page
 * included. Three mutations were like that (`auth.revokeMySessions`,
 * `auth.logout`, `shopping.generateFromLowStock`), and they were exactly the
 * ones a cross-site form could trigger, because there was no input for the
 * form to fail. A mutation that takes nothing says so with `z.void()`.
 *
 * The walk is over the router as it runs, so a mutation added tomorrow without
 * an input is named here rather than found by the next audit. Queries are not
 * held to it: they write nothing.
 */

interface ProcedureDef {
  _def: { type: string; inputs: unknown[] };
}

// Flat and dotted at runtime, nested in the type — the same honest double cast
// as `replayable.test.ts`.
const procedures = appRouter._def.procedures as unknown as Record<
  string,
  ProcedureDef
>;

const mutations = Object.entries(procedures)
  .filter(([, procedure]) => procedure._def.type === "mutation")
  .map(([path]) => path)
  .toSorted();

describe("mutation inputs", () => {
  it("finds the mutations to check", () => {
    // A walk that found nothing would pass every assertion below.
    expect(mutations.length).toBeGreaterThan(30);
    expect(mutations).toContain("auth.revokeMySessions");
  });

  it("every mutation declares an input parser", () => {
    const without = mutations.filter(
      (path) => (procedures[path] as ProcedureDef)._def.inputs.length === 0,
    );
    expect(without).toEqual([]);
  });

  it.each(["auth.revokeMySessions", "auth.logout", "shopping.generateFromLowStock"])(
    "%s accepts nothing but no input",
    (path) => {
      const schema = (procedures[path] as ProcedureDef)._def.inputs[0] as {
        safeParse: (value: unknown) => { success: boolean };
      };
      const form = new FormData();
      form.set("x", "1");

      expect(schema.safeParse(undefined).success).toBe(true);
      // `z.object({})` would let both of these through.
      expect(schema.safeParse(form).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
    },
  );

  it("auth.endSessions asks for the password, and for the session when it ends one", () => {
    // D143. Without the password a session somebody else holds could end the
    // owner's; without the id, "one" would have nothing to scope to.
    const schema = (procedures["auth.endSessions"] as ProcedureDef)._def.inputs[0] as {
      safeParse: (value: unknown) => { success: boolean };
    };
    const ok = (value: unknown) => schema.safeParse(value).success;

    expect(ok({ currentPassword: "x", scope: "all" })).toBe(true);
    expect(ok({ currentPassword: "x", scope: "others" })).toBe(true);
    expect(ok({ currentPassword: "x", scope: "one", sessionId: "s1" })).toBe(true);

    expect(ok({ scope: "all" })).toBe(false);
    expect(ok({ currentPassword: "", scope: "all" })).toBe(false);
    expect(ok({ currentPassword: "x", scope: "one" })).toBe(false);
    expect(ok({ currentPassword: "x", scope: "one", sessionId: "" })).toBe(false);
    expect(ok({ currentPassword: "x", scope: "one", sessionId: "s".repeat(65) })).toBe(false);
    expect(ok({ currentPassword: "x", scope: "everyone" })).toBe(false);
    expect(ok({ currentPassword: "x".repeat(MAX_PASSWORD_LENGTH + 1), scope: "all" })).toBe(false);
  });
});
