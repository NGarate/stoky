/**
 * What the release scripts ask of GitHub, in one place the tests replace.
 *
 * `scripts/release-prepare.ts` and `scripts/release-tag.ts` take these as
 * their defaults; their tests pass stubs instead, so no test talks to GitHub
 * or pushes anywhere. Everything here needs `gh` signed in as someone who may
 * push to the repository, which is why both scripts are the owner's to run.
 *
 * Pushes go over HTTPS with gh's credentials, never to `origin`: origin is an
 * SSH URL, and in a session with no display (an agent's, a terminal over SSH)
 * the key's passphrase prompt has nowhere to appear and the push fails with
 * "Permission denied (publickey)". gh's credential helper has no prompt.
 */
import { execFileSync } from "node:child_process";

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** OWNER/NAME of the repository gh resolves from the checkout. */
export function repository(cwd: string): string {
  return run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd).trim();
}

/** `git push` of `refspec` to the repository over HTTPS, authenticated by gh. */
export function pushOverHttps(cwd: string, refspec: string): void {
  const url = `https://github.com/${repository(cwd)}.git`;
  execFileSync(
    "git",
    ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "push", url, refspec],
    { cwd, stdio: ["ignore", "inherit", "inherit"] },
  );
}

export interface CiRun {
  databaseId: number;
  status: string;
  conclusion: string;
  url: string;
}

export interface CiJob {
  name: string;
  status: string;
  conclusion: string;
}

/** The newest `ci.yml` run of `sha` on `branch` (a tag name for a tag's run), or null. */
export function newestCiRun(cwd: string, options: { branch: string; sha?: string; event?: string }): CiRun | null {
  const args = ["run", "list", "--workflow", "ci.yml", "--branch", options.branch, "--limit", "1"];
  if (options.event) args.push("--event", options.event);
  if (options.sha) args.push("--commit", options.sha);
  args.push("--json", "databaseId,status,conclusion,url");
  const runs = JSON.parse(run("gh", args, cwd)) as CiRun[];
  return runs[0] ?? null;
}

/** The jobs of a run, by name. */
export function ciJobs(cwd: string, id: number): CiJob[] {
  return (JSON.parse(run("gh", ["run", "view", String(id), "--json", "jobs"], cwd)) as { jobs: CiJob[] }).jobs;
}

/** Opens a pull request and returns its URL. */
export function createPullRequest(
  cwd: string,
  options: { base: string; head: string; title: string; bodyFile: string },
): string {
  const output = run(
    "gh",
    [
      "pr",
      "create",
      "--base",
      options.base,
      "--head",
      options.head,
      "--title",
      options.title,
      "--body-file",
      options.bodyFile,
    ],
    cwd,
  );
  return output.trim().split("\n").at(-1) ?? "";
}
