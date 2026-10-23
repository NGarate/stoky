/**
 * Tags a merged release preparation, signed, and pushes the tag.
 *
 * Run: bun scripts/release-tag.ts
 *
 * The second of the owner's release commands, after the pull request
 * `scripts/release-prepare.ts` opened has been reviewed and merged into
 * master with a fast-forward. It takes no version: the version is the one
 * the merged preparation names, so the tag cannot disagree with it.
 *
 * It refuses, creating nothing, unless:
 *   - origin/master's head commit (after `git fetch`) is `chore: prepare <tag>`,
 *     exactly: a squash merge's "(#N)" suffix is refused, because a squash
 *     orphans the SHAs the notes' change list links;
 *   - package.json at that commit holds <tag>'s version;
 *   - <tag> exists neither here nor on origin;
 *   - the newest CI push run of that commit on master succeeded, its
 *     `Publish image` job included: the tag run promotes an image built from
 *     this tree, and master's run is where a broken build shows first;
 *   - tag signing is configured (`gpg.format`, `user.signingkey` and, for SSH
 *     keys, `gpg.ssh.allowedSignersFile`, without which nothing here can
 *     verify the signature).
 *
 * Then `git tag -s <tag> -m "Stoky <tag>" <sha>`, `git verify-tag <tag>` (a
 * tag that does not verify is deleted again, never pushed), the push of the
 * tag over HTTPS with gh's credentials (scripts/release-github.ts), and the
 * URL of the CI run the tag starts. Next: once that run's `release-draft`
 * job is green, verify the draft (`release:verify`), then publish it
 * (`release:publish`).
 *
 * Exit codes: 0 tagged and pushed, 1 refused, 2 a usage error or a question
 * git or gh could not answer.
 */
import { join } from "node:path";
import * as github from "./release-github";
import { REPOSITORY } from "./release-notes";
import { git, localTagExists, originTagExists, ReleaseError, TAG } from "./release-version";

export const PUBLISH_JOB = "Publish image";
const PREPARE = /^chore: prepare (\S+)$/;

export interface TagDeps {
  cwd: string;
  fetch: () => void;
  remoteTagExists: (tag: string) => boolean;
  /** The newest CI push run of `sha` on master, or null. */
  ciRun: (sha: string) => github.CiRun | null;
  ciJobs: (id: number) => github.CiJob[];
  push: (refspec: string) => void;
  /** The newest CI run of `tag`, or null while GitHub has not listed it. */
  tagRun: (tag: string) => github.CiRun | null;
  sleep: (ms: number) => void;
  out: (line: string) => void;
  err: (line: string) => void;
}

export function defaultDeps(cwd: string): TagDeps {
  return {
    cwd,
    fetch: () => git(cwd, ["fetch", "--quiet", "origin"]),
    remoteTagExists: (tag) => originTagExists(cwd, tag),
    ciRun: (sha) => github.newestCiRun(cwd, { branch: "master", event: "push", sha }),
    ciJobs: (id) => github.ciJobs(cwd, id),
    push: (refspec) => github.pushOverHttps(cwd, refspec),
    tagRun: (tag) => github.newestCiRun(cwd, { branch: tag }),
    sleep: (ms) => Bun.sleepSync(ms),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  };
}

function config(cwd: string, key: string): string {
  try {
    return git(cwd, ["config", "--get", key]).trim();
  } catch {
    return "";
  }
}

/** Refuses unless `git tag -s` can sign and `git verify-tag` can check it. */
function checkSigning(cwd: string): void {
  const format = config(cwd, "gpg.format") || "openpgp";
  const key = config(cwd, "user.signingkey");
  const missing: string[] = [];
  if (!key) missing.push("git config user.signingkey <the key, or its public key file with ssh-agent>");
  if (format === "ssh" && !config(cwd, "gpg.ssh.allowedSignersFile")) {
    missing.push("git config gpg.ssh.allowedSignersFile <a file listing your email and public key>");
  }
  if (missing.length) {
    throw new ReleaseError(
      `release tags are signed, and signing is not configured here (gpg.format is ${format}). Set:\n` +
        (format === "ssh" ? "" : "  git config gpg.format ssh   (or keep openpgp with a GPG key)\n") +
        missing.map((line) => `  ${line}`).join("\n"),
    );
  }
}

function checkPreconditions(deps: TagDeps) {
  const { cwd } = deps;
  try {
    deps.fetch();
  } catch (error) {
    throw new ReleaseError(`git fetch origin failed: ${(error as { stderr?: string }).stderr?.trim() ?? error}`, 2);
  }
  const sha = git(cwd, ["rev-parse", "origin/master"]).trim();
  const subject = git(cwd, ["log", "-1", "--format=%s", sha]).trim();
  const prepared = subject.match(PREPARE);
  if (!prepared || !TAG.test(prepared[1])) {
    throw new ReleaseError(
      `origin/master's head (${sha.slice(0, 7)}) is "${subject}", not "chore: prepare vX.Y.Z". ` +
        "Merge the release pull request with a fast-forward first (a squash merge's subject is refused: " +
        "it orphans the commits the change list links).",
    );
  }
  const tag = prepared[1];
  const version = (JSON.parse(git(cwd, ["show", `${sha}:package.json`])) as { version?: string }).version;
  if (`v${version}` !== tag) {
    throw new ReleaseError(`${sha.slice(0, 7)} says "chore: prepare ${tag}", but its package.json holds ${version}.`);
  }
  if (localTagExists(cwd, tag)) throw new ReleaseError(`${tag} already exists here (git tag -l ${tag}).`);
  if (deps.remoteTagExists(tag)) throw new ReleaseError(`${tag} already exists on origin.`);
  const run = deps.ciRun(sha);
  if (!run) throw new ReleaseError(`no CI push run on master for ${sha.slice(0, 7)} yet. Wait for it.`);
  if (run.status !== "completed") {
    throw new ReleaseError(`CI for ${sha.slice(0, 7)} is still ${run.status}: wait for it, image included. ${run.url}`);
  }
  if (run.conclusion !== "success") {
    throw new ReleaseError(`CI for ${sha.slice(0, 7)} ended ${run.conclusion}. ${run.url}`);
  }
  const publish = deps.ciJobs(run.databaseId).find((job) => job.name === PUBLISH_JOB);
  if (publish?.conclusion !== "success") {
    throw new ReleaseError(
      `CI for ${sha.slice(0, 7)} did not publish its image ("${PUBLISH_JOB}" is ${publish ? publish.conclusion || publish.status : "missing"}). ` +
        `Re-run the push's own run (docs/RELEASING.md) and wait for it. ${run.url}`,
    );
  }
  checkSigning(cwd);
  return { sha, tag, run };
}

export function tagRelease(argv: string[], deps: TagDeps): number {
  if (argv.length) {
    deps.err("usage: bun scripts/release-tag.ts   (it takes the version from origin/master's preparation)");
    return 2;
  }
  let checked: ReturnType<typeof checkPreconditions>;
  try {
    checked = checkPreconditions(deps);
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;
    deps.err(`Refused, nothing tagged: ${error.message}`);
    return error.exitCode;
  }
  const { sha, tag } = checked;
  const { cwd } = deps;

  try {
    git(cwd, ["tag", "-s", tag, "-m", `Stoky ${tag}`, sha]);
  } catch (error) {
    deps.err(`Error: git tag -s failed, nothing tagged: ${(error as { stderr?: string }).stderr?.trim() ?? error}`);
    return 1;
  }
  try {
    git(cwd, ["verify-tag", tag]);
  } catch (error) {
    git(cwd, ["tag", "-d", tag]);
    deps.err(
      `Error: ${tag}'s signature does not verify, so it was deleted again and not pushed: ` +
        `${(error as { stderr?: string }).stderr?.trim() ?? error}\n` +
        "Check that gpg.ssh.allowedSignersFile lists your email with the key user.signingkey names.",
    );
    return 1;
  }
  deps.out(`Signed ${tag} on ${sha.slice(0, 7)}; git verify-tag accepts it.`);

  try {
    deps.push(`refs/tags/${tag}:refs/tags/${tag}`);
  } catch (error) {
    deps.err(
      `Error: the push failed: ${(error as Error).message}\n` +
        `${tag} exists here only. Push it by hand, or delete it with git tag -d ${tag}:\n` +
        `  git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push ${REPOSITORY}.git refs/tags/${tag}`,
    );
    return 1;
  }
  deps.out(`Pushed ${tag}.`);

  let run: github.CiRun | null = null;
  for (let attempt = 0; attempt < 12 && !run; attempt++) {
    if (attempt) deps.sleep(5000);
    try {
      run = deps.tagRun(tag);
    } catch {
      run = null;
    }
  }
  deps.out(
    run
      ? `Its CI run: ${run.url}`
      : `GitHub has not listed its CI run yet: gh run list --workflow ci.yml --branch ${tag}`,
  );
  deps.out(
    "Next: when that run's release-draft job is green, verify the draft (release:verify), then publish it (release:publish).",
  );
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(tagRelease(Bun.argv.slice(2), defaultDeps(join(import.meta.dir, ".."))));
  } catch (error) {
    console.error(`Error: ${(error as { stderr?: string }).stderr?.trim() || (error as Error).message}`);
    process.exit(2);
  }
}
