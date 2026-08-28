import { test as setup, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { e2eDatabaseUrl } from "./db-url";

const run = promisify(execFile);

/**
 * Put the demo household back before anything reads it.
 *
 * **The suite writes.** Confirming a receipt line, ticking a shopping item and
 * consuming stock are all real mutations against the seeded fixture, and the
 * fixture is finite: three confirmable receipt lines. So the third run of
 * `screen-reader.spec.ts` failed with "no receipt in the list still has an item
 * to confirm", which is a suite that works once and then reports a defect that
 * is not there. It happened twice in one afternoon.
 *
 * That is ISSUES.md TEST-3's class for the third time — a test coupled to state
 * another run consumed — and the two previous answers were local: make *this*
 * test create its own list. That does not work here. Producing a receipt with
 * parsed lines means an upload and an OCR pass, which is minutes and a language
 * download (OCR-1), so this journey has to start from the fixture.
 *
 * So the fixture is restored instead. Since 2026-08-17 that restoration — and
 * everything else the suite does — happens in the suite's **own database**,
 * `stoky_e2e`, never the one a developer's `bun run dev` is reading. The seed
 * used to run against the shared dev database, scoped to the demo household,
 * and that scoping was not enough: it reset the household the owner was
 * actively testing with. See `e2e/db-url.ts`.
 *
 * A project of its own rather than three lines at the top of `session.setup.ts`
 * so that a failure reads as "seeding failed" rather than as "sign-in failed",
 * which is a much longer walk to the same conclusion.
 */
setup("seed the demo household", async () => {
  // The suite's own database, never the developer's — see e2e/db-url.ts.
  const env = { ...process.env, DATABASE_URL: e2eDatabaseUrl() };

  // `migrate deploy` creates the database when it does not exist and applies
  // the committed migrations; on an already-migrated database it is a no-op.
  // Doing it here rather than in a workflow step means local and CI runs have
  // one setup path, and a fresh clone needs no manual step.
  const migrate = await run("bunx", ["prisma", "migrate", "deploy"], {
    env,
    timeout: 120_000,
  }).catch((error: unknown) => ({ stdout: "", stderr: String(error) }));

  expect(
    migrate.stdout,
    `\`prisma migrate deploy\` failed against the suite's database.\n${migrate.stderr}`,
  ).toMatch(/have been applied|No pending migrations|up to date/);

  // No `cwd`: Playwright's loader hands this file to CommonJS, where
  // `import.meta` is a syntax error, and `bun run` walks up to the nearest
  // package.json on its own — so the inherited working directory is enough.
  const result = await run("bun", ["run", "db:seed"], {
    env,
    // A seed that hangs must not eat the suite's whole budget.
    timeout: 120_000,
  }).catch((error: unknown) => ({ stdout: "", stderr: String(error) }));

  expect(
    result.stdout,
    "`bun run db:seed` did not report success. The browser suite needs the demo " +
      `household, and every run consumes part of it.\n${result.stderr}`,
  ).toContain("seed command has been executed");
});
