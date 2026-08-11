import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ISSUES.md DEBT-4: seven of the eight routers threw bare `Error`, so an
 * authorisation refusal or a missing row arrived at the client as
 * INTERNAL_SERVER_ERROR — indistinguishable from the server falling over, and
 * therefore impossible to recover from in the interface.
 *
 * The behavioural half of this check is in the integration suite, which
 * asserts the actual codes. This half is structural and exists because the
 * behavioural half can only cover the conditions it thinks to provoke: a
 * router can grow a new `throw new Error` at any time and no behavioural test
 * would notice until someone hit that path in production.
 */

const ROUTER_DIR = join(import.meta.dir, "../../server/trpc/routers");

describe("router error types", () => {
  const files = readdirSync(ROUTER_DIR).filter((f) => f.endsWith(".ts"));

  it("reads a non-empty set of routers", () => {
    // Without this, a wrong path would make every check below vacuously pass.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`throws only TRPCError in ${file}`, () => {
      const source = readFileSync(join(ROUTER_DIR, file), "utf8");
      const bare = source
        .split("\n")
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => /throw new Error\b/.test(line));

      expect(bare).toEqual([]);
    });
  }

  it("holds the services layer to the same rule", () => {
    // This used to assert the opposite — that the services were *still*
    // unconverted — so that fixing DEBT-6 would fail here and send whoever did
    // it back to close the entry rather than leave a stale claim behind. That
    // worked: it went red, and this is the other side of it.
    //
    // The services throw the domain errors in `services/errors.ts` rather than
    // `TRPCError`, because `processReceiptOcr` runs from a background task with
    // no client attached; `trpc/service-errors.ts` turns them into statuses at
    // the boundary.
    const servicesDir = join(import.meta.dir, "../../server/services");
    const withBareErrors = readdirSync(servicesDir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /throw new Error\b/.test(readFileSync(join(servicesDir, f), "utf8")));

    expect(withBareErrors).toEqual([]);
  });
});
