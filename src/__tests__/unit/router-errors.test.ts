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

  it("pins the services layer as still unconverted, so fixing it goes red here", () => {
    // Deliberate scope note rather than an oversight: `ocr`, `productMatcher`,
    // `receiptParser` and `openFoodFacts` still throw bare Errors, and a
    // procedure that calls one still surfaces INTERNAL_SERVER_ERROR. That is
    // the same defect one layer down and is filed separately rather than
    // fixed in passing (PROGRESS.md D6), as ISSUES.md DEBT-6.
    //
    // Like DEBT-2 and A11Y-1, it is pinned by a test that fails when the
    // defect is fixed — so whoever fixes it is sent here to close the entry
    // rather than leaving a stale claim behind.
    const servicesDir = join(import.meta.dir, "../../server/services");
    const withBareErrors = readdirSync(servicesDir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /throw new Error\b/.test(readFileSync(join(servicesDir, f), "utf8")));

    expect(withBareErrors.length).toBeGreaterThan(0);
  });
});
