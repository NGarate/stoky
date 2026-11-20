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
});
it("throws \`here\`", () => { throw new Error("boom \`\`\` fence"); });
`;

describe("the failing-test summary", () => {
  it("names each failed test with its suite, file, line and message", () => {
    const summary = summarize({ unit: report(failing) });
    expect(summary).toStartWith("### 2 failing tests\n");
    expect(summary).toContain(
      "**unit** · `fixture.test.ts:4` · receipts > parses <a & b>",
    );
    expect(summary).toContain('-   "total": 2,\n+   "total": 1,');
    expect(summary).toContain("**unit** · `fixture.test.ts:6` · throws `here`");
    // A message holding a fence cannot close the block it is printed in.
    expect(summary).toContain("````text\nboom ``` fence\n````");
    expect(summary).not.toContain("passes");
  });

  it("says when the reports name no failure", () => {
    const passing = report(
      `import { it } from "bun:test";\nit("ok", () => {});\nit("fails", () => { throw new Error("x"); });\n`,
    );
    const clean = passing.replace(/<failure\b[\s\S]*?<\/failure>/g, "");
    expect(summarize({ components: clean })).toStartWith("### No test failed");
  });

  it("says when no suite wrote a report", () => {
    expect(summarize({})).toStartWith("### No test report");
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
      "::error file=fixture.test.ts,line=6,title=unit%3A throws `here`::boom ``` fence",
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
    expect(summary).toStartWith("earlier step\n### 2 failing tests\n");
  });
});
