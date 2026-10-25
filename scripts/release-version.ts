/**
 * The next release's tag, from package.json and the bump the owner asks for.
 *
 * Run: bun scripts/release-version.ts <bump | vX.Y.Z[-alpha.N]>
 *
 *   prerelease  0.1.0-alpha.4 → v0.1.0-alpha.5   (a stable version refuses:
 *                                                  use prepatch or preminor)
 *   prepatch    0.1.0-alpha.5 → v0.1.1-alpha.1
 *   preminor    0.1.0-alpha.5 → v0.2.0-alpha.1
 *   premajor    0.1.0-alpha.5 → v1.0.0-alpha.1
 *   patch       0.1.0-alpha.5 → v0.1.0            0.1.0 → v0.1.1
 *   minor       0.1.0-alpha.5 → v0.1.0            0.1.1 → v0.2.0
 *   major       0.1.0-alpha.5 → v1.0.0            1.0.0-alpha.2 → v1.0.0
 *   release     0.1.0-alpha.5 → v0.1.0
 *   v0.3.0      exactly that tag
 *
 * The increments are semver's (npm's `semver.inc`), with two choices of this
 * project: the prerelease identifier is always `alpha`, and the first
 * prerelease number is 1, because the history starts at v0.1.0-alpha.1 and
 * semver's 0 would put an `alpha.0` before it.
 *
 * It prints the tag, with its `v`, on stdout and nothing else, so
 * `scripts/release-prepare.ts` and a shell can both take it as it is. It
 * refuses a tag that is not greater than package.json's version (by
 * `Bun.semver.order`), that already exists here or on `origin`, or that
 * `scripts/release-assets.sh` would refuse as a tag. When the commits since the
 * previous `v*` tag carry a breaking marker (`type!:` or a `BREAKING CHANGE:`
 * footer, the same markers `scripts/release-notes.ts` lists under 🚨) and the
 * bump is patch, prepatch or prerelease, it says on stderr that a breaking
 * change usually takes a larger one. That is a hint, not a refusal: an alpha
 * that breaks the previous alpha is still an alpha.
 *
 * Exit codes: 0 printed, 1 refused, 2 a usage error or a question git could
 * not answer (no origin to ask, for one).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The tag shape `scripts/release-assets.sh` accepts; OCI tags take no `+build`. */
export const TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$/;
export const PRERELEASE_ID = "alpha";
export const BUMPS = [
  "prerelease",
  "prepatch",
  "preminor",
  "premajor",
  "patch",
  "minor",
  "major",
  "release",
] as const;
export type Bump = (typeof BUMPS)[number];
export const USAGE = `usage: bun scripts/release-version.ts <${BUMPS.join("|")}|vX.Y.Z[-alpha.N]>`;

/** A refusal or usage error a release script reports and exits with. */
export class ReleaseError extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2 = 1,
  ) {
    super(message);
  }
}

interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parse(version: string): Version {
  const match = version.match(SEMVER);
  if (!match)
    throw new ReleaseError(
      `"${version}" is not a version this script understands (X.Y.Z[-alpha.N]).`,
      2,
    );
  return {
    major: +match[1],
    minor: +match[2],
    patch: +match[3],
    pre: match[4] ? match[4].split(".") : [],
  };
}

function format({ major, minor, patch, pre }: Version): string {
  return `${major}.${minor}.${patch}${pre.length ? `-${pre.join(".")}` : ""}`;
}

export function isBump(request: string): request is Bump {
  return (BUMPS as readonly string[]).includes(request);
}

/** `current` (no `v`) incremented by `bump`, as semver does with this project's two choices. */
export function increment(current: string, bump: Bump): string {
  const v = parse(current);
  const first = [PRERELEASE_ID, "1"];
  const prerelease = v.pre.length > 0;
  switch (bump) {
    case "prerelease": {
      if (!prerelease) {
        throw new ReleaseError(
          `${current} is not a prerelease, so it has no next one. Start the next version's alphas with prepatch or preminor.`,
        );
      }
      const last = v.pre.at(-1) ?? "";
      if (v.pre[0] === PRERELEASE_ID && /^\d+$/.test(last)) {
        return format({
          ...v,
          pre: [...v.pre.slice(0, -1), String(Number(last) + 1)],
        });
      }
      // 1.0.0-alpha → 1.0.0-alpha.1; another identifier (beta) restarts at
      // alpha.1, which sorts lower and is refused by the order check.
      return format({
        ...v,
        pre: v.pre[0] === PRERELEASE_ID ? [...v.pre, "1"] : first,
      });
    }
    case "prepatch":
      return format({ ...v, patch: v.patch + 1, pre: first });
    case "preminor":
      return format({ ...v, minor: v.minor + 1, patch: 0, pre: first });
    case "premajor":
      return format({ major: v.major + 1, minor: 0, patch: 0, pre: first });
    case "patch":
      return format({
        ...v,
        patch: prerelease ? v.patch : v.patch + 1,
        pre: [],
      });
    case "minor":
      return prerelease && v.patch === 0
        ? format({ ...v, pre: [] })
        : format({ ...v, minor: v.minor + 1, patch: 0, pre: [] });
    case "major":
      return prerelease && v.minor === 0 && v.patch === 0
        ? format({ ...v, pre: [] })
        : format({ major: v.major + 1, minor: 0, patch: 0, pre: [] });
    case "release":
      if (!prerelease)
        throw new ReleaseError(
          `${current} is already a release. Use patch, minor or major.`,
        );
      return format({ ...v, pre: [] });
  }
}

/**
 * The tag `request` (a bump or an explicit version) asks for after `current`,
 * refused unless it is a release tag greater than `current`. Pure: whether the
 * tag exists is `resolveTag`'s question.
 */
export function nextTag(current: string, request: string): string {
  parse(current);
  let next: string;
  if (isBump(request)) next = increment(current, request);
  else if (/^v?\d/.test(request)) next = request.replace(/^v/, "");
  else
    throw new ReleaseError(
      `"${request}" is neither a bump nor a version.\n${USAGE}`,
      2,
    );
  const tag = `v${next}`;
  if (!TAG.test(tag) || !SEMVER.test(next)) {
    throw new ReleaseError(
      `${tag} is not a release tag scripts/release-assets.sh accepts (such as v0.1.0-alpha.1).`,
    );
  }
  if (Bun.semver.order(next, current) !== 1) {
    throw new ReleaseError(
      `${tag} is not greater than the current version, ${current}.`,
    );
  }
  return tag;
}

/** The markers `scripts/release-notes.ts` files under 🚨 Cambios incompatibles. */
export function isBreaking(subject: string, body: string): boolean {
  return (
    /^\w+(\([^)]+\))?!: \S/.test(subject) || /^BREAKING[ -]CHANGE: /m.test(body)
  );
}

/** Said on stderr when a breaking change is about to ship under a small bump. */
export function breakingHint(
  request: string,
  current: string,
  breaking: string[],
): string | null {
  if (
    breaking.length === 0 ||
    !["patch", "prepatch", "prerelease"].includes(request)
  )
    return null;
  const larger =
    parse(current).major === 0
      ? "a minor (preminor or minor)"
      : "a major (premajor or major)";
  return (
    `Note: ${breaking.length} commit(s) since the previous release are marked breaking ` +
    `(${breaking.join("; ")}). A breaking change ${parse(current).major === 0 ? "in 0.x " : ""}usually takes ${larger}, ` +
    `not ${request}. Continue if this one is meant to stay where it is.`
  );
}

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function localTagExists(cwd: string, tag: string): boolean {
  return git(cwd, ["tag", "-l", tag]).trim() !== "";
}

/** Whether `origin` has `tag`. Throws when origin cannot be asked: unknown is not "no". */
export function originTagExists(cwd: string, tag: string): boolean {
  try {
    return (
      git(cwd, ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]).trim() !==
      ""
    );
  } catch (error) {
    const detail =
      (error as { stderr?: string }).stderr?.trim() ?? String(error);
    throw new ReleaseError(
      `Could not ask origin whether ${tag} exists: ${detail}`,
      2,
    );
  }
}

/** The newest `v*` tag reachable from HEAD, or null in a history with none. */
export function previousTag(cwd: string): string | null {
  try {
    return (
      git(cwd, ["describe", "--tags", "--abbrev=0", "--match", "v*"]).trim() ||
      null
    );
  } catch {
    return null;
  }
}

/** Short SHA and subject of each commit since `previous` that carries a breaking marker. */
export function breakingSince(cwd: string, previous: string): string[] {
  const log = git(cwd, [
    "log",
    "--no-merges",
    "--format=%h%x1f%s%x1f%b%x1e",
    `${previous}..HEAD`,
  ]);
  return log
    .split("\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter(Boolean)
    .map((record) => record.split("\x1f"))
    .filter(([, subject, body]) => isBreaking(subject, body ?? ""))
    .map(([sha, subject]) => `${sha} ${subject}`);
}

export interface VersionDeps {
  /** The repository: package.json and git are read here. */
  cwd: string;
  remoteTagExists: (tag: string) => boolean;
}

export function defaultVersionDeps(cwd: string): VersionDeps {
  return { cwd, remoteTagExists: (tag) => originTagExists(cwd, tag) };
}

export function packageVersion(cwd: string): string {
  return (
    JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
}

export interface Resolved {
  tag: string;
  current: string;
  previous: string | null;
  hint: string | null;
}

/** The tag `request` asks for in the repository at `deps.cwd`, every refusal applied. */
export function resolveTag(request: string, deps: VersionDeps): Resolved {
  const current = packageVersion(deps.cwd);
  const tag = nextTag(current, request);
  if (localTagExists(deps.cwd, tag))
    throw new ReleaseError(`${tag} already exists here (git tag -l ${tag}).`);
  if (deps.remoteTagExists(tag))
    throw new ReleaseError(`${tag} already exists on origin.`);
  const previous = previousTag(deps.cwd);
  const hint = previous
    ? breakingHint(request, current, breakingSince(deps.cwd, previous))
    : null;
  return { tag, current, previous, hint };
}

function main(argv: string[]): number {
  if (argv.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  try {
    const { tag, hint } = resolveTag(
      argv[0],
      defaultVersionDeps(join(import.meta.dir, "..")),
    );
    if (hint) console.error(hint);
    console.log(tag);
    return 0;
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;
    console.error(`Error: ${error.message}`);
    return error.exitCode;
  }
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)));
