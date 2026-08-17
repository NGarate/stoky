import { describe, it, expect } from "bun:test";
import { e2eDatabaseUrl, e2eValkeyUrl } from "../../../e2e/db-url";

/**
 * The browser suite's isolated connections.
 *
 * These functions decide which database and cache the suite touches, and the
 * whole point of them is that the answer is never the developer's. On
 * 2026-08-17 the suite reseeded the demo household in the owner's own database
 * while they were testing with it; `stoky_e2e` and Valkey db 1 are the fix,
 * and these tests pin the derivation so a refactor cannot quietly point the
 * suite back at real data.
 */

describe("e2eDatabaseUrl", () => {
  it("replaces the database name, keeping credentials, host and query", () => {
    expect(
      e2eDatabaseUrl({
        DATABASE_URL:
          "postgresql://stoky:stoky_dev_password@localhost:5432/stoky?schema=public",
      }),
    ).toBe(
      "postgresql://stoky:stoky_dev_password@localhost:5432/stoky_e2e?schema=public",
    );
  });

  it("prefers an explicit E2E_DATABASE_URL verbatim", () => {
    expect(
      e2eDatabaseUrl({
        DATABASE_URL: "postgresql://a:b@localhost:5432/stoky",
        E2E_DATABASE_URL: "postgresql://x:y@elsewhere:5432/anything",
      }),
    ).toBe("postgresql://x:y@elsewhere:5432/anything");
  });

  it("refuses to run with neither, naming both variables", () => {
    expect(() => e2eDatabaseUrl({})).toThrow(/E2E_DATABASE_URL.*DATABASE_URL/);
  });
});

describe("e2eValkeyUrl", () => {
  it("moves the derived connection onto db index 1", () => {
    expect(e2eValkeyUrl({ VALKEY_URL: "redis://localhost:6379" })).toBe(
      "redis://localhost:6379/1",
    );
  });

  it("prefers an explicit E2E_VALKEY_URL verbatim", () => {
    expect(e2eValkeyUrl({ E2E_VALKEY_URL: "redis://cache:6379" })).toBe(
      "redis://cache:6379",
    );
  });

  it("defaults to localhost like src/lib/valkey.ts does", () => {
    expect(e2eValkeyUrl({})).toBe("redis://localhost:6379/1");
  });
});
