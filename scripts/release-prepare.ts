/**
 * The start of a release: the preparation commit, on a branch, as a pull
 * request for the owner to review.
 *
 * Run: bun scripts/release-prepare.ts <bump | vX.Y.Z[-alpha.N]> [--refresh-images] [--no-push]
 *
 *   bump              what scripts/release-version.ts takes: prerelease,
 *                     prepatch, preminor, premajor, patch, minor, major,
 *                     release, or an explicit tag
 *   --refresh-images  first move deploy/docker-compose.yml's PostgreSQL,
 *                     Valkey and Traefik to their newest clean builds
 *                     (scripts/release-refresh-images.ts), in a commit of
 *                     their own
 *   --no-push         stop before pushing: the branch stays local
 *
 * It does what docs/RELEASING.md's "Prepare a reviewable version" did by hand
 * in 7fffc6e (chore: prepare v0.1.0-alpha.4), so a release starts from one
 * command the owner runs and every step after it is a review:
 *
 *   1. Refuses, changing nothing, unless: the checkout is on a clean master
 *      equal to origin/master; the newest CI push run for that commit on
 *      master succeeded; docs/releases/NEXT.md exists with its
 *      `## Cómo actualizar`, `## Qué ha cambiado` and `## English`; the guide
 *      describes the current release only (no "the release after"); and the
 *      tag the bump names is free (release-version.ts's refusals).
 *   2. Creates release/<tag> from master.
 *   3. With --refresh-images, runs the refresh and commits what it wrote as
 *      `build(docker): refresh the bundle's service images for <tag>`. A red
 *      candidate (exit 1) or an error (exit 2) stops here.
 *   4. Commits `chore: prepare <tag>`: the version in package.json,
 *      deploy/example.env (STOKY_VERSION) and deploy/install.sh
 *      (DEFAULT_VERSION); the previous tag replaced by the new one in
 *      README.md and docs/INSTALL.md, the README's link to its notes
 *      included; NEXT.md renamed to docs/releases/<tag>.md with its
 *      `## Qué ha cambiado` filled by `bun scripts/release-notes.ts`. The list
 *      is generated after step 3, so the refresh commit is in it.
 *   5. Runs scripts/release-assets.sh with a placeholder digest, the same
 *      check the tag's CI run starts with.
 *   6. Pushes release/<tag> and opens its pull request, with the notes as
 *      its description.
 *
 * A failure after step 2 leaves the branch as it is, for inspection; the
 * message says how to discard it. Merge the pull request with a fast-forward
 * (`git merge --ff-only`, then push master), never GitHub's squash: the change
 * list links each commit by SHA, the refresh commit among them, and
 * release-assets.sh checks that list against the history on the tag. Then
 * `bun scripts/release-tag.ts`.
 *
 * Needs `gh` signed in (it reads the CI run, pushes and opens the pull
 * request). Pushes go over HTTPS with gh's credentials
 * (scripts/release-github.ts). Exit codes: 0 prepared, 1 refused or a step
 * failed, 2 a usage error or a question git or gh could not answer.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as github from "./release-github";
import { REPOSITORY } from "./release-notes";
import { git, originTagExists, packageVersion, previousTag, ReleaseError, resolveTag } from "./release-version";

export const NEXT_NOTES = "docs/releases/NEXT.md";
export const REQUIRED_HEADINGS = ["## Cómo actualizar", "## Qué ha cambiado", "## English"];
const CHANGES_HEADING = "## Qué ha cambiado";
/** The guide describes the release it ships with; upgrade paths live in the notes. */
const RELEASE_AFTER = /the release after/i;
const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;
const USAGE = "usage: bun scripts/release-prepare.ts <bump|vX.Y.Z[-alpha.N]> [--refresh-images] [--no-push]";

export interface PrepareDeps {
  /** The repository's root. */
  cwd: string;
  fetch: () => void;
  remoteTagExists: (tag: string) => boolean;
  /** The newest CI push run of `sha` on master, or null when there is none. */
  ciRun: (sha: string) => github.CiRun | null;
  /** scripts/release-refresh-images.ts's exit code: 0 done, 1 a red candidate, 2 an error. */
  refreshImages: () => number;
  push: (refspec: string) => void;
  /** Opens the pull request; returns its URL. */
  createPullRequest: (options: { base: string; head: string; title: string; bodyFile: string }) => string;
  out: (line: string) => void;
  err: (line: string) => void;
}

export function defaultDeps(cwd: string): PrepareDeps {
  return {
    cwd,
    fetch: () => git(cwd, ["fetch", "--quiet", "origin"]),
    remoteTagExists: (tag) => originTagExists(cwd, tag),
    ciRun: (sha) => github.newestCiRun(cwd, { branch: "master", event: "push", sha }),
    refreshImages: () => {
      const script = join(cwd, "scripts/release-refresh-images.ts");
      if (!existsSync(script)) {
        console.error(`Error: ${script} does not exist in this checkout.`);
        return 2;
      }
      return spawnSync("bun", [script], { cwd, stdio: "inherit" }).status ?? 2;
    },
    push: (refspec) => github.pushOverHttps(cwd, refspec),
    createPullRequest: (options) => github.createPullRequest(cwd, options),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  };
}

/** The body of `heading`'s section (up to the next `## `) replaced by `body`. */
export function replaceSection(markdown: string, heading: string, body: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === heading);
  if (start === -1) throw new ReleaseError(`no "${heading}" heading to fill.`);
  const after = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const tail = after === -1 ? [] : ["", ...lines.slice(after)];
  const result = [...lines.slice(0, start + 1), "", body.replace(/\n+$/, ""), ...tail].join("\n");
  return after === -1 ? `${result}\n` : result;
}

/** Every `tag` in `text` that is the whole version, so v0.1.0-alpha.4 leaves v0.1.0-alpha.40 alone. */
function tagPattern(tag: string): RegExp {
  return new RegExp(`(?<![0-9A-Za-z.])${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9A-Za-z])`, "g");
}

/** Replaces the one line `pattern` matches in `file`, or refuses. */
function setLine(cwd: string, file: string, pattern: RegExp, line: string): void {
  const path = join(cwd, file);
  const text = readFileSync(path, "utf8");
  const matches = text.match(new RegExp(pattern.source, "gm")) ?? [];
  if (matches.length !== 1) throw new ReleaseError(`${file} must have exactly one line matching ${pattern}.`);
  writeFileSync(path, text.replace(new RegExp(pattern.source, "m"), line));
}

/**
 * The preparation edits, in the working tree, and the paths they touched.
 * `list` is release-notes.ts's output for previous..HEAD.
 */
export function applyPreparation(
  cwd: string,
  options: { previous: string; tag: string; list: string },
): { paths: string[]; replaced: Record<string, number> } {
  const { previous, tag, list } = options;
  const version = tag.slice(1);

  const pkgPath = join(cwd, "package.json");
  const pkg = readFileSync(pkgPath, "utf8");
  const updated = pkg.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`);
  if ((JSON.parse(updated) as { version?: string }).version !== version) {
    throw new ReleaseError("package.json's top-level version could not be set.");
  }
  writeFileSync(pkgPath, updated);
  setLine(cwd, "deploy/example.env", /^STOKY_VERSION=.*$/, `STOKY_VERSION=${tag}`);
  setLine(cwd, "deploy/install.sh", /^DEFAULT_VERSION=.*$/, `DEFAULT_VERSION=${tag}`);

  const replaced: Record<string, number> = {};
  for (const doc of ["README.md", "docs/INSTALL.md"]) {
    const path = join(cwd, doc);
    const text = readFileSync(path, "utf8");
    replaced[doc] = text.match(tagPattern(previous))?.length ?? 0;
    writeFileSync(path, text.replace(tagPattern(previous), tag));
  }

  const notes = `docs/releases/${tag}.md`;
  git(cwd, ["mv", NEXT_NOTES, notes]);
  const notesPath = join(cwd, notes);
  writeFileSync(notesPath, replaceSection(readFileSync(notesPath, "utf8"), CHANGES_HEADING, list));

  return {
    // NEXT.md's removal is already staged by the git mv.
    paths: ["package.json", "deploy/example.env", "deploy/install.sh", "README.md", "docs/INSTALL.md", notes],
    replaced,
  };
}

/** What NEXT.md lacks to become a release's notes, or an empty list. */
export function missingHeadings(markdown: string): string[] {
  const headings = new Set(markdown.split("\n").map((line) => line.trimEnd()));
  return REQUIRED_HEADINGS.filter((heading) => !headings.has(heading));
}

interface Options {
  request: string;
  refreshImages: boolean;
  push: boolean;
}

function parseArgs(argv: string[]): Options | null {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const flags = argv.filter((arg) => arg.startsWith("--"));
  if (positional.length !== 1 || flags.some((flag) => flag !== "--refresh-images" && flag !== "--no-push")) {
    return null;
  }
  return { request: positional[0], refreshImages: flags.includes("--refresh-images"), push: !flags.includes("--no-push") };
}

/** Every refusal of step 1; changes nothing but the fetched remote refs. */
function checkPreconditions(options: Options, deps: PrepareDeps) {
  const { cwd } = deps;
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (branch !== "master") throw new ReleaseError(`the checkout is on ${branch}. Releases start from master: git switch master`);
  const dirty = git(cwd, ["status", "--porcelain"]).trimEnd();
  if (dirty) {
    throw new ReleaseError(`the working tree is not clean. Commit or stash these first:\n${dirty}`);
  }
  try {
    deps.fetch();
  } catch (error) {
    throw new ReleaseError(`git fetch origin failed: ${(error as { stderr?: string }).stderr?.trim() ?? error}`, 2);
  }
  const local = git(cwd, ["rev-parse", "master"]).trim();
  const remote = git(cwd, ["rev-parse", "origin/master"]).trim();
  if (local !== remote) {
    throw new ReleaseError(
      `master (${local.slice(0, 7)}) is not origin/master (${remote.slice(0, 7)}). ` +
        "A release is cut from what has landed: push master, or pull it, until they are the same.",
    );
  }
  const run = deps.ciRun(local);
  if (!run) {
    throw new ReleaseError(`no CI push run on master for ${local.slice(0, 7)} yet. Push master and wait for its run.`);
  }
  if (run.status !== "completed") {
    throw new ReleaseError(`CI for ${local.slice(0, 7)} is still ${run.status}: wait for it to pass. ${run.url}`);
  }
  if (run.conclusion !== "success") {
    throw new ReleaseError(`CI for ${local.slice(0, 7)} ended ${run.conclusion}: master must be green first. ${run.url}`);
  }
  const notesPath = join(cwd, NEXT_NOTES);
  if (!existsSync(notesPath)) {
    throw new ReleaseError(
      `${NEXT_NOTES} does not exist. Write this release's notes there first (docs/RELEASING.md, step 2), on master.`,
    );
  }
  const missing = missingHeadings(readFileSync(notesPath, "utf8"));
  if (missing.length) {
    throw new ReleaseError(`${NEXT_NOTES} lacks ${missing.map((h) => `"${h}"`).join(", ")}. Add them on master first.`);
  }
  const forward = readFileSync(join(cwd, "docs/INSTALL.md"), "utf8")
    .split("\n")
    .map((line, index) => [index + 1, line] as const)
    .filter(([, line]) => RELEASE_AFTER.test(line));
  if (forward.length) {
    throw new ReleaseError(
      "docs/INSTALL.md speaks of a release after this one; the guide describes the current release only, " +
        "and what depends on the version an installation comes from belongs in the notes. Reword it on master:\n" +
        forward.map(([n, line]) => `  docs/INSTALL.md:${n}: ${line}`).join("\n"),
    );
  }
  const previous = previousTag(cwd);
  if (!previous) throw new ReleaseError("there is no v* tag to list the changes since.");
  const current = packageVersion(cwd);
  if (`v${current}` !== previous) {
    throw new ReleaseError(`package.json says ${current}, but the newest tag is ${previous}. They must agree before a bump.`);
  }
  const { tag, hint } = resolveTag(options.request, { cwd, remoteTagExists: deps.remoteTagExists });
  const branchName = `release/${tag}`;
  for (const ref of [`refs/heads/${branchName}`, `refs/remotes/origin/${branchName}`]) {
    if (git(cwd, ["for-each-ref", ref]).trim()) {
      throw new ReleaseError(`${ref} already exists. Delete it if it is a failed attempt, then run this again.`);
    }
  }
  return { tag, previous, current, hint, branchName, base: local };
}

export function prepare(argv: string[], deps: PrepareDeps): number {
  const options = parseArgs(argv);
  if (!options) {
    deps.err(USAGE);
    return 2;
  }
  let checked: ReturnType<typeof checkPreconditions>;
  try {
    checked = checkPreconditions(options, deps);
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;
    deps.err(`Refused, nothing changed: ${error.message}`);
    return error.exitCode;
  }
  const { tag, previous, current, hint, branchName } = checked;
  const { cwd } = deps;
  if (hint) deps.err(hint);

  const leave = (message: string, code = 1) => {
    deps.err(`Error: ${message}`);
    deps.err(
      `The branch ${branchName} is left as it is, for inspection. To discard it:\n` +
        `  git switch master && git branch -D ${branchName}`,
    );
    return code;
  };

  git(cwd, ["switch", "--quiet", "--create", branchName]);
  deps.out(`On ${branchName}, from master ${checked.base.slice(0, 7)}.`);

  if (options.refreshImages) {
    const code = deps.refreshImages();
    if (code === 1) return leave("a candidate service image is red under the release scan; nothing was refreshed.");
    if (code !== 0) return leave(`scripts/release-refresh-images.ts failed (exit ${code}).`);
    const changed = git(cwd, ["status", "--porcelain"]).trimEnd();
    if (changed === " M deploy/docker-compose.yml") {
      git(cwd, ["add", "deploy/docker-compose.yml"]);
      const subject = `build(docker): refresh the bundle's service images for ${tag}`;
      git(cwd, [
        "commit",
        "--quiet",
        "-m",
        subject,
        "-m",
        "Each service image moves to the newest build of its major that the release " +
          "scan passes (scripts/release-refresh-images.ts), so the release does not ship " +
          "builds older than upstream's. Written by scripts/release-prepare.ts.",
      ]);
      deps.out(subject);
    } else if (changed) {
      return leave(`the image refresh changed more than deploy/docker-compose.yml:\n${changed}`);
    } else {
      deps.out("The service images are already the newest clean builds; nothing to commit.");
    }
  }

  let list: string;
  try {
    list = execFileSync("bun", [join(cwd, "scripts/release-notes.ts"), previous, tag], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return leave(`scripts/release-notes.ts failed: ${(error as { stderr?: string }).stderr?.trim() ?? error}`);
  }
  const count = Number(git(cwd, ["rev-list", "--count", `${previous}..HEAD`]).trim());

  let prepared: ReturnType<typeof applyPreparation>;
  try {
    prepared = applyPreparation(cwd, { previous, tag, list });
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;
    return leave(`${error.message} The working tree holds the edits made before it.`);
  }
  git(cwd, ["add", "--", ...prepared.paths]);
  const notes = `docs/releases/${tag}.md`;
  const body = [
    `Requested: ${options.request}, ${current} to ${tag.slice(1)}. ${count} commit(s) since ${previous}, not counting this one.`,
    `The version moves to ${tag.slice(1)} everywhere release-assets.sh holds it to the tag: package.json, ` +
      `deploy/example.env's STOKY_VERSION and deploy/install.sh's DEFAULT_VERSION. README.md ` +
      `(${prepared.replaced["README.md"]}) and docs/INSTALL.md (${prepared.replaced["docs/INSTALL.md"]}) ` +
      `name ${tag} where they named ${previous}.`,
    `${NEXT_NOTES} becomes ${notes}, its "Qué ha cambiado" filled by ` +
      `\`bun scripts/release-notes.ts ${previous} ${tag}\`. This commit is a chore, which the list ` +
      "leaves out, so the list stays exact with it in the range.",
    "Written by scripts/release-prepare.ts.",
  ];
  git(cwd, ["commit", "--quiet", "-m", `chore: prepare ${tag}`, ...body.flatMap((paragraph) => ["-m", paragraph])]);
  deps.out(`chore: prepare ${tag} (${count} commit(s) since ${previous})`);

  const assets = mkdtempSync(join(tmpdir(), "stoky-release-prepare-"));
  try {
    const check = spawnSync("bash", [join(cwd, "scripts/release-assets.sh"), tag, assets, ZERO_DIGEST], {
      cwd,
      encoding: "utf8",
    });
    if (check.status !== 0) {
      return leave(`scripts/release-assets.sh refused ${tag}:\n${(check.stderr || check.stdout).trimEnd()}`);
    }
  } finally {
    rmSync(assets, { recursive: true, force: true });
  }
  deps.out(`scripts/release-assets.sh accepts ${tag}.`);

  if (!options.push) {
    deps.out(
      `Not pushed (--no-push). Review the branch, then push it and open its pull request:\n` +
        `  git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push ${REPOSITORY}.git ${branchName}\n` +
        `  gh pr create --base master --head ${branchName} --title "chore: prepare ${tag}" --body-file ${notes}`,
    );
    return 0;
  }
  try {
    deps.push(`${branchName}:refs/heads/${branchName}`);
  } catch (error) {
    return leave(`the push failed: ${(error as Error).message}`);
  }
  let url: string;
  try {
    url = deps.createPullRequest({
      base: "master",
      head: branchName,
      title: `chore: prepare ${tag}`,
      bodyFile: join(cwd, notes),
    });
  } catch (error) {
    return leave(`the branch is pushed, but the pull request could not be opened: ${(error as Error).message}`);
  }
  deps.out(`Pull request: ${url}`);
  deps.out(
    "Next: review it and wait for its CI. Merge it with a fast-forward, not GitHub's squash " +
      "(the change list links each commit by SHA):\n" +
      `  git switch master && git merge --ff-only ${branchName}\n` +
      "  then push master over HTTPS as above. Once master's CI run, its image included, is green:\n" +
      "  bun scripts/release-tag.ts",
  );
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(prepare(Bun.argv.slice(2), defaultDeps(join(import.meta.dir, ".."))));
  } catch (error) {
    console.error(`Error: ${(error as { stderr?: string }).stderr?.trim() || (error as Error).message}`);
    process.exit(2);
  }
}
