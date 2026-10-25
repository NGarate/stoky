/**
 * A release's change list, from its commits, in the shape Immich's releases
 * use: one heading per kind of change, an emoji to find it by, one line per
 * change with its link, and the full comparison at the end.
 *
 * Run: bun scripts/release-notes.ts vPREVIOUS vNEXT
 *      bun scripts/release-notes.ts --check docs/releases/vNEXT.md vNEXT
 *
 * The first prints the list for vPREVIOUS..HEAD, wrapped in the markers a
 * release's notes carry it between. Paste it into the notes under
 * `## Qué ha cambiado`. The second regenerates the list between those markers
 * (the start marker names vPREVIOUS) and exits 1 when it differs from the
 * file: scripts/release-assets.sh runs it on every tag, so a release cannot
 * publish a list that leaves out a commit it ships or names one it does not.
 *
 * Immich builds its list from pull-request labels. Here most changes reach
 * master without a pull request, so the source is the Conventional Commit
 * every subject already is (CLAUDE.md, Commit Convention):
 *
 *   🚨 Cambios incompatibles  `type!:` or a `BREAKING CHANGE:` footer
 *   🔒 Seguridad              a `Changelog: security` trailer
 *   🚀 Novedades              feat
 *   🌟 Mejoras                perf
 *   🐛 Correcciones           fix
 *   📦 Dependencias e imágenes build(deps), build(deps-dev), build(docker)
 *   📚 Documentación          docs that touch what an operator reads: README.md,
 *                             SECURITY.md, docs/INSTALL.md
 *   🧩 Otros                  a subject that is not a Conventional Commit
 *
 * A commit is listed once, under the first of those that fits. Everything
 * else — ci, test, refactor, style, chore, other build, docs about the
 * project's own process — is internal, left out, and reachable through the
 * full comparison. A `Changelog: skip` trailer leaves out a commit that would
 * otherwise be listed. Subjects are listed as written, in English, as
 * Immich lists its pull-request titles; the prose above the list is where a
 * release explains itself in Spanish first.
 *
 * Exit codes: 0 printed (or in step), 1 the file's list differs, 2 a usage
 * error, an unknown tag, or a file without the markers.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const REPOSITORY = "https://github.com/NGarate/stoky";
const TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$/;
export const START = (previous: string) =>
  `<!-- cambios:inicio ${previous} -->`;
export const END = "<!-- cambios:fin -->";
const MARKED = /<!-- cambios:inicio (\S+) -->\n([\s\S]*?)<!-- cambios:fin -->/;

/** Files an operator reads; a docs commit that touches one is listed. */
const OPERATOR_DOCS = new Set(["README.md", "SECURITY.md", "docs/INSTALL.md"]);

export interface Commit {
  sha: string;
  subject: string;
  body: string;
  /** Values of `Changelog:` trailers, lowercased. */
  changelog: string[];
  /** Paths the commit touched. Read only for docs commits. */
  files: () => string[];
}

const SECTIONS = [
  ["breaking", "🚨 Cambios incompatibles"],
  ["security", "🔒 Seguridad"],
  ["feature", "🚀 Novedades"],
  ["enhancement", "🌟 Mejoras"],
  ["fix", "🐛 Correcciones"],
  ["dependency", "📦 Dependencias e imágenes"],
  ["documentation", "📚 Documentación"],
  ["other", "🧩 Otros"],
] as const;
type Section = (typeof SECTIONS)[number][0];

const HEADER = /^(\w+)(?:\(([^)]+)\))?(!)?: \S/;

/** Where a commit is listed, or null when it is internal. */
export function sectionOf(commit: Commit): Section | null {
  if (commit.changelog.includes("skip")) return null;
  const header = commit.subject.match(HEADER);
  if (!header) return "other";
  const [, type, scope, bang] = header;
  if (bang || /^BREAKING[ -]CHANGE: /m.test(commit.body)) return "breaking";
  if (commit.changelog.includes("security")) return "security";
  switch (type) {
    case "feat":
      return "feature";
    case "perf":
      return "enhancement";
    case "fix":
      return "fix";
    case "build":
      return scope === "deps" || scope === "deps-dev" || scope === "docker"
        ? "dependency"
        : null;
    case "docs":
      return commit.files().some((file) => OPERATOR_DOCS.has(file))
        ? "documentation"
        : null;
    default:
      return null;
  }
}

/** One list line: the subject, linked to its pull request when it names one. */
function line(commit: Commit): string {
  const short = commit.sha.slice(0, 7);
  const commitLink = `[\`${short}\`](${REPOSITORY}/commit/${commit.sha})`;
  const pull = commit.subject.match(/ \(#(\d+)\)$/);
  if (!pull) return `* ${commit.subject} (${commitLink})`;
  const subject = commit.subject.slice(0, pull.index);
  return `* ${subject} in [#${pull[1]}](${REPOSITORY}/pull/${pull[1]}) (${commitLink})`;
}

/** The marked list for `commits` (oldest first), between two tags. */
export function render(
  commits: Commit[],
  previous: string,
  next: string,
): string {
  const grouped = new Map<Section, Commit[]>();
  for (const commit of commits) {
    const section = sectionOf(commit);
    if (section)
      grouped.set(section, [...(grouped.get(section) ?? []), commit]);
  }
  const parts = [START(previous)];
  for (const [key, title] of SECTIONS) {
    const listed = grouped.get(key);
    if (!listed) continue;
    parts.push("", `### ${title}`, "", ...listed.map(line));
  }
  if (grouped.size === 0)
    parts.push("", "Ningún cambio visible; solo cambios internos.");
  parts.push(
    "",
    "Los cambios internos (CI, pruebas, refactorizaciones, documentación del proyecto) no se listan; están en la comparación completa.",
    "",
    `**Changelog completo**: ${REPOSITORY}/compare/${previous}...${next}`,
    END,
  );
  return parts.join("\n");
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** The commits after `previous` up to HEAD, oldest first, merges left out. */
export function commitsSince(previous: string): Commit[] {
  const FIELD = "\x1f";
  const RECORD = "\x1e";
  const log = git([
    "log",
    "--no-merges",
    "--reverse",
    `--format=%H${FIELD}%s${FIELD}%b${FIELD}%(trailers:key=Changelog,valueonly,separator=%x2C)${RECORD}`,
    `${previous}..HEAD`,
  ]);
  return log
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ""))
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, body, trailers] = record.split(FIELD);
      return {
        sha,
        subject,
        body,
        changelog: trailers
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
        files: () =>
          git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha])
            .split("\n")
            .filter(Boolean),
      };
    });
}

function main(argv: string[]): number {
  const usage =
    "usage: bun scripts/release-notes.ts vPREVIOUS vNEXT | --check NOTES_FILE vNEXT";
  const tagExists = (tag: string) => {
    try {
      git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  };

  if (argv[0] === "--check") {
    const [, file, next] = argv;
    if (!file || !next || argv.length !== 3 || !TAG.test(next)) {
      console.error(usage);
      return 2;
    }
    const marked = readFileSync(file, "utf8").match(MARKED);
    if (!marked) {
      console.error(
        `Error: ${file} has no change list between ${START("vPREVIOUS")} and ${END}.`,
      );
      return 2;
    }
    const previous = marked[1];
    if (!TAG.test(previous) || !tagExists(previous)) {
      console.error(
        `Error: ${file} lists changes since ${previous}, which is not a tag here.`,
      );
      return 2;
    }
    const expected = render(commitsSince(previous), previous, next);
    if (marked[0] !== expected) {
      console.error(
        `Error: the change list in ${file} is not the one ${previous}..HEAD gives. Regenerate it:\n` +
          `  bun scripts/release-notes.ts ${previous} ${next}`,
      );
      return 1;
    }
    return 0;
  }

  const [previous, next] = argv;
  if (argv.length !== 2 || !TAG.test(previous ?? "") || !TAG.test(next ?? "")) {
    console.error(usage);
    return 2;
  }
  if (!tagExists(previous)) {
    console.error(`Error: ${previous} is not a tag here.`);
    return 2;
  }
  console.log(render(commitsSince(previous), previous, next));
  return 0;
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)));
