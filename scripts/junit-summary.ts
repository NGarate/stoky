/**
 * Names the failing tests of a CI job where a reader looks first.
 *
 * Run: bun scripts/junit-summary.ts <dir>
 *      (ci.yml's test jobs, only when one has failed)
 *
 * `scripts/ci-in-image.sh` has each suite write a JUnit report into <dir>
 * (`bun test --reporter=junit`), one `<suite>.xml` per suite. On a runner
 * (GITHUB_STEP_SUMMARY set) this appends every failed test, with its file,
 * line and message, to the job's summary, and prints the first ten as error
 * annotations, which `gh run view <id>` lists: "what failed" answered
 * without the whole log. Anywhere else it prints the summary.
 */
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** At most this many failures are listed; a run past it is read in the log. */
const MAX_FAILURES = 50;
/** GitHub shows ten error annotations per step and drops the rest. */
const MAX_ANNOTATIONS = 10;
/** A message is cut here: an object diff can run to hundreds of lines. */
const MAX_MESSAGE = 2000;

type Failure = {
  suite: string;
  file: string;
  line: string;
  title: string;
  message: string;
};

const ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

/** XML character references and the five named entities, decoded. */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, ref: string) => {
    if (/^#x/i.test(ref)) {
      return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    }
    if (ref.startsWith("#")) return String.fromCodePoint(Number(ref.slice(1)));
    return ENTITIES[ref] ?? whole;
  });
}

function attributes(text: string): Record<string, string> {
  return Object.fromEntries(
    [...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [
      name,
      decode(value),
    ]),
  );
}

/** Every failed test case in `reports` (suite name → JUnit XML). */
function failures(reports: Record<string, string>): Failure[] {
  return Object.keys(reports)
    .toSorted()
    .flatMap((suite) =>
      [
        ...reports[suite].matchAll(
          /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g,
        ),
      ].flatMap(([, open, body]) => {
        const failure = body?.match(/<failure\b([^>]*?)(?:\/>|>)/);
        if (!failure) return [];
        const test = attributes(open);
        const message = (attributes(failure[1]).message ?? "").trimEnd();
        return [
          {
            suite,
            file: test.file ?? "",
            line: test.line ?? "",
            // Bun writes `classname` innermost describe first; the console
            // prints outermost first. shortcut: a describe named with " > "
            // comes out split, upgrade by reading the nested <testsuite>s.
            title: [
              ...(test.classname?.split(" > ").toReversed() ?? []),
              test.name,
            ]
              .filter(Boolean)
              .join(" > "),
            message:
              message.length > MAX_MESSAGE
                ? `${message.slice(0, MAX_MESSAGE)}\n[cut: read the log]`
                : message,
          },
        ];
      }),
    );
}

/** A fence no backtick run in `text` can close. */
function fenced(text: string): string {
  const longest = Math.max(
    2,
    ...[...text.matchAll(/`+/g)].map((run) => run[0].length),
  );
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
}

/** A title as Markdown text: no tag in it can open, such as `<details>`. */
const text = (title: string) =>
  title.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

/** Bun leaves a test file that fails to load out of its report. */
const UNLOADED =
  "A test file that fails to load is in no report: only the log names it.";

/** The failures in `reports`, as the Markdown of a job summary. */
export function summarize(reports: Record<string, string>): string {
  const names = Object.keys(reports).toSorted();
  if (names.length === 0) {
    return "### No test report\n\nNo suite wrote one: the job failed before its suite ran, or every file the suite ran failed to load. Read its log.\n";
  }
  const found = failures(reports);
  if (found.length === 0) {
    return `### No test failed\n\nThe reports (${names.join(", ")}) name no failure, so the job failed outside a test: read its log.\n\n${UNLOADED}\n`;
  }
  const shown = found
    .slice(0, MAX_FAILURES)
    .map(
      (f) =>
        `**${f.suite}** · \`${f.file}:${f.line}\` · ${text(f.title)}\n\n${fenced(f.message)}`,
    );
  const more =
    found.length > shown.length
      ? `\n\n…and ${found.length - shown.length} more: read the log.`
      : "";
  return `### ${found.length} failing test${found.length === 1 ? "" : "s"}\n\n${shown.join("\n\n")}${more}\n\n${UNLOADED}\n`;
}

/** Workflow-command escaping: the data, and a property value. */
const data = (text: string) =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const property = (text: string) =>
  data(text).replaceAll(":", "%3A").replaceAll(",", "%2C");

/** The first failures as `::error` workflow commands, one per line. */
export function annotations(reports: Record<string, string>): string {
  return failures(reports)
    .slice(0, MAX_ANNOTATIONS)
    .map(
      (f) =>
        `::error file=${property(f.file)},line=${property(f.line)},title=${property(`${f.suite}: ${f.title}`)}::${data(f.message)}\n`,
    )
    .join("");
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: bun scripts/junit-summary.ts <dir>");
    process.exit(2);
  }
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".xml"));
  } catch {
    // No directory: no suite got as far as writing a report.
  }
  const reports = Object.fromEntries(
    files.map((file) => [
      file.slice(0, -".xml".length),
      readFileSync(join(dir, file), "utf8"),
    ]),
  );
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(summary, summarize(reports));
    process.stdout.write(annotations(reports));
  } else {
    process.stdout.write(summarize(reports));
  }
}
