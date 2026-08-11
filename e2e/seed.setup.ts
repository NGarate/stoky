import { test as setup, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
 * So the fixture is restored instead. The seed deletes only the demo
 * household's rows — scoped by `householdId` throughout — so this resets what
 * the suite owns and touches nothing a developer has in the same database.
 *
 * A project of its own rather than three lines at the top of `session.setup.ts`
 * so that a failure reads as "seeding failed" rather than as "sign-in failed",
 * which is a much longer walk to the same conclusion.
 */
setup("seed the demo household", async () => {
  // No `cwd`: Playwright's loader hands this file to CommonJS, where
  // `import.meta` is a syntax error, and `pnpm` walks up to the nearest
  // package.json on its own — so the inherited working directory is enough.
  const result = await run("pnpm", ["db:seed"], {
    // A seed that hangs must not eat the suite's whole budget.
    timeout: 120_000,
  }).catch((error: unknown) => ({ stdout: "", stderr: String(error) }));

  expect(
    result.stdout,
    "`pnpm db:seed` did not report success. The browser suite needs the demo " +
      `household, and every run consumes part of it.\n${result.stderr}`,
  ).toContain("seed command has been executed");
});
