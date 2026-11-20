import { afterAll, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { annotations, summarize } from "../../../scripts/junit-summary";

/**
 * CI's test jobs print their failing tests into the run's summary from the
 * JUnit reports `bun test --reporter=junit` writes. The reports here are
 * written by the Bun running this test, not typed by hand, so a change in
 * Bun's format fails this file rather than leave CI's summary empty.
 */

const script = join(import.meta.dir, "../../../scripts/junit-summary.ts");
const scratch = mkdtempSync(join(tmpdir(), "stoky-junit-summary-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Runs `source` as a test file under `bun test`, and returns its report. */
function report(source: string): string {
  const dir = mkdtempSync(join(scratch, "suite-"));
  writeFileSync(join(dir, "fixture.test.ts"), source);
  const run = Bun.spawnSync(
    [
      process.execPath,
      "test",
      "--reporter=junit",
      "--reporter-outfile=report.xml",
      "./fixture.test.ts",
    ],
    { cwd: dir, env: { PATH: process.env.PATH } },
  );
  // The console output stays: a report is written beside it, not instead.
  expect(run.stderr.toString()).toContain("(fail)");
  return readFileSync(join(dir, "report.xml"), "utf8");
}

const failing = `import { describe, expect, it } from "bun:test";
describe("receipts", () => {
  it("passes", () => expect(1).toBe(1));
  it("parses <a & b>", () => expect({ total: 1 }).toEqual({ total: 2 }));
  describe("totals, in cents", () => {
    it("hands its <details> on", () => expect(1).toBe(2));
  });
});
it("throws \`here\`", () => { throw new Error("boom \`\`\` fence"); });
`;

describe("the failing-test summary", () => {
  it("names each failed test with its suite, file, line and message", () => {
    const summary = summarize({ unit: report(failing) });
    expect(summary).toStartWith("### 3 failing tests\n");
    // A title is text: its `<details>` must not fold the rest of the summary.
    expect(summary).toContain(
      "**unit** · `fixture.test.ts:4` · receipts > parses &lt;a &amp; b>",
    );
    expect(summary).toContain('-   "total": 2,\n+   "total": 1,');
    // Outermost describe first, as the console prints it.
    expect(summary).toContain(
      "**unit** · `fixture.test.ts:6` · receipts > totals, in cents > hands its &lt;details> on",
    );
    expect(summary).toContain("**unit** · `fixture.test.ts:9` · throws `here`");
    // A message holding a fence cannot close the block it is printed in.
    expect(summary).toContain("````text\nboom ``` fence\n````");
    expect(summary).not.toContain("passes");
    expect(summary).toEndWith(
      "\n\nA test file that fails to load is in no report: only the log names it.\n",
    );
  });

  it("says when the reports name no failure", () => {
    const passing = report(
      `import { it } from "bun:test";\nit("ok", () => {});\nit("fails", () => { throw new Error("x"); });\n`,
    );
    const clean = passing.replace(/<failure\b[\s\S]*?<\/failure>/g, "");
    const summary = summarize({ components: clean });
    expect(summary).toStartWith("### No test failed");
    expect(summary).toContain("A test file that fails to load is in no report");
  });

  // Bun writes no report when every file it ran failed to load.
  it("says when no suite wrote a report", () => {
    expect(summarize({})).toBe(
      "### No test report\n\nNo suite wrote one: the job failed before its suite ran, or every file the suite ran failed to load. Read its log.\n",
    );
  });

  it("lists fifty and counts the rest", () => {
    const many = Array.from(
      { length: 52 },
      (_, n) =>
        `<testcase name="t${n}" classname="" file="f.test.ts" line="${n}"><failure message="m${n}" /></testcase>`,
    ).join("\n");
    const summary = summarize({ unit: `<testsuites>${many}</testsuites>` });
    expect(summary).toStartWith("### 52 failing tests");
    expect(summary).toContain("· t49\n");
    expect(summary).not.toContain("· t50\n");
    expect(summary).toContain("…and 2 more: read the log.");
  });

  it("reads every report in the directory, as the job runs it", () => {
    const dir = mkdtempSync(join(scratch, "reports-"));
    writeFileSync(join(dir, "integration.xml"), report(failing));
    const run = Bun.spawnSync([process.execPath, script, dir]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toContain(
      "**integration** · `fixture.test.ts:4`",
    );
    const missing = Bun.spawnSync([process.execPath, script, join(dir, "no")]);
    expect(missing.stdout.toString()).toStartWith("### No test report");
  });

  // `gh run view` prints a run's annotations, not its summaries.
  it("annotates the first ten failures, escaped as workflow commands", () => {
    const xml = report(failing);
    expect(annotations({ unit: xml }).split("\n")).toEqual([
      expect.stringMatching(
        /^::error file=fixture\.test\.ts,line=4,title=unit%3A receipts > parses <a & b>::expect\(received\)\.toEqual\(expected\)%0A%0A/,
      ),
      expect.stringMatching(
        /^::error file=fixture\.test\.ts,line=6,title=unit%3A receipts > totals%2C in cents > hands its <details> on::expect\(received\)\.toBe\(expected\)%0A/,
      ),
      "::error file=fixture.test.ts,line=9,title=unit%3A throws `here`::boom ``` fence",
      "",
    ]);
    const many = `<testsuites>${'<testcase name="t" file="f" line="1"><failure message="m" /></testcase>'.repeat(12)}</testsuites>`;
    expect(annotations({ unit: many }).trimEnd().split("\n")).toHaveLength(10);
  });

  it("on a runner, appends the summary and prints the annotations", () => {
    const dir = mkdtempSync(join(scratch, "runner-"));
    mkdirSync(join(dir, "reports"));
    writeFileSync(join(dir, "reports", "unit.xml"), report(failing));
    writeFileSync(join(dir, "summary.md"), "earlier step\n");
    const run = Bun.spawnSync(
      [process.execPath, script, join(dir, "reports")],
      {
        env: {
          PATH: process.env.PATH,
          GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
        },
      },
    );
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toStartWith("::error file=fixture.test.ts");
    const summary = readFileSync(join(dir, "summary.md"), "utf8");
    expect(summary).toStartWith("earlier step\n### 3 failing tests\n");
  });
});
