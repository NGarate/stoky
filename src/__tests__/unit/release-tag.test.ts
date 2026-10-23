import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CiJob, CiRun } from "../../../scripts/release-github";
import { PUBLISH_JOB, type TagDeps, tagRelease } from "../../../scripts/release-tag";

/**
 * `scripts/release-tag.ts` signs and pushes the tag of a merged preparation.
 * These run it in a throwaway repository with a bare `origin`, GitHub
 * stubbed, and a throwaway ed25519 key generated here for the signature:
 * never the owner's key, and never the owner's ssh-agent.
 */

const tag = "v0.1.0-alpha.5";
const fixtures: string[] = [];
const green: CiRun = { databaseId: 7, status: "completed", conclusion: "success", url: "https://ci.example/run/7" };
const jobs = (publish: Partial<CiJob> | null): CiJob[] => [
  { name: "Lint, types, contrast", status: "completed", conclusion: "success" },
  ...(publish ? [{ name: PUBLISH_JOB, status: "completed", conclusion: "success", ...publish }] : []),
];

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [key, value] of Object.entries({
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    SSH_AUTH_SOCK: undefined,
  })) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function repository(options: { subject?: string; version?: string } = {}) {
  const base = mkdtempSync(join(tmpdir(), "stoky-tag-"));
  fixtures.push(base);
  const origin = join(base, "origin.git");
  const dir = join(base, "work");
  const key = join(base, "signing-key");
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "release-tag test", "-f", key]);
  const allowed = join(base, "allowed-signers");
  writeFileSync(allowed, `test@example.invalid ${readFileSync(`${key}.pub`, "utf8")}`);
  execFileSync("git", ["init", "-q", "--bare", "-b", "master", origin]);
  mkdirSync(dir);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "master");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgSign", "false");
  git("config", "gpg.format", "ssh");
  git("config", "user.signingkey", key);
  git("config", "gpg.ssh.allowedSignersFile", allowed);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "0.1.0-alpha.4" }));
  git("add", "package.json");
  git("commit", "-q", "-m", "chore: prepare v0.1.0-alpha.4");
  git("tag", "v0.1.0-alpha.4");
  git("commit", "-q", "--allow-empty", "-m", "feat(inventory): scan a barcode");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: options.version ?? "0.1.0-alpha.5" }));
  git("add", "package.json");
  git("commit", "-q", "-m", options.subject ?? `chore: prepare ${tag}`);
  git("remote", "add", "origin", origin);
  git("push", "-q", "origin", "master", "v0.1.0-alpha.4");

  const state = {
    ci: green as CiRun | null,
    jobs: jobs({}),
    remoteTags: [] as string[],
    tagRun: { ...green, databaseId: 8, url: "https://ci.example/run/8" } as CiRun | null,
    pushFails: false,
  };
  const calls = { pushed: [] as string[], ciRun: [] as string[], ciJobs: [] as number[], slept: 0 };
  const out: string[] = [];
  const err: string[] = [];
  const deps = (): TagDeps => ({
    cwd: dir,
    fetch: () => git("fetch", "-q", "origin"),
    remoteTagExists: (name) => state.remoteTags.includes(name),
    ciRun: (sha) => {
      calls.ciRun.push(sha);
      return state.ci;
    },
    ciJobs: (id) => {
      calls.ciJobs.push(id);
      return state.jobs;
    },
    push: (refspec) => {
      calls.pushed.push(refspec);
      if (state.pushFails) throw new Error("push refused");
      git("push", "-q", "origin", refspec);
    },
    tagRun: () => state.tagRun,
    sleep: () => calls.slept++,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  const originTags = () =>
    execFileSync("git", ["for-each-ref", "--format=%(refname)", "refs/tags"], { cwd: origin, encoding: "utf8" });
  return {
    dir,
    origin,
    git,
    allowed,
    state,
    calls,
    out,
    err,
    originTags,
    run: (...argv: string[]) => tagRelease(argv, deps()),
  };
}

describe("tagging a merged release", () => {
  it("signs the preparation commit, verifies the signature, pushes the tag and names its CI run", () => {
    const repo = repository();
    const head = repo.git("rev-parse", "master").trim();
    expect(repo.run()).toBe(0);
    expect(repo.err).toEqual([]);

    expect(repo.git("rev-parse", `${tag}^{commit}`).trim()).toBe(head);
    expect(repo.git("cat-file", "-t", tag).trim()).toBe("tag");
    const object = repo.git("cat-file", "tag", tag);
    expect(object).toContain("-----BEGIN SSH SIGNATURE-----");
    expect(object).toContain(`Stoky ${tag}`);
    // Verified here with the test's own allowed-signers file, independently of the script.
    expect(() => repo.git("verify-tag", tag)).not.toThrow();

    expect(repo.calls.ciRun).toEqual([head]);
    expect(repo.calls.ciJobs).toEqual([green.databaseId]);
    expect(repo.calls.pushed).toEqual([`refs/tags/${tag}:refs/tags/${tag}`]);
    expect(repo.originTags()).toContain(`refs/tags/${tag}\n`);
    const said = repo.out.join("\n");
    expect(said).toContain("https://ci.example/run/8");
    expect(said).toContain("release:verify");
    expect(said).toContain("release:publish");
  });

  it("waits for GitHub to list the tag's run, and says where to look when it does not", () => {
    const repo = repository();
    repo.state.tagRun = null;
    expect(repo.run()).toBe(0);
    expect(repo.calls.slept).toBe(11);
    expect(repo.out.join("\n")).toContain(`gh run list --workflow ci.yml --branch ${tag}`);
  });

  it("deletes a tag whose signature does not verify, and pushes nothing", () => {
    const repo = repository();
    // Another key in the allowed signers: the signature is made, but not by a listed key.
    const other = join(repo.dir, "..", "other-key");
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "other", "-f", other]);
    writeFileSync(repo.allowed, `test@example.invalid ${readFileSync(`${other}.pub`, "utf8")}`);
    expect(repo.run()).toBe(1);
    expect(repo.err.join("\n")).toContain("does not verify");
    expect(repo.git("tag", "-l", tag).trim()).toBe("");
    expect(repo.calls.pushed).toEqual([]);
    expect(repo.originTags()).not.toContain(tag);
  });

  it("keeps the local tag and says how to push it when the push fails", () => {
    const repo = repository();
    repo.state.pushFails = true;
    expect(repo.run()).toBe(1);
    expect(repo.err.join("\n")).toContain(`push https://github.com/NGarate/stoky.git refs/tags/${tag}`);
    expect(repo.git("tag", "-l", tag).trim()).toBe(tag);
  });
});

describe("refusing to tag", () => {
  const cases: [string, Parameters<typeof repository>[0], (repo: ReturnType<typeof repository>) => void, RegExp][] = [
    ["a head that is not a preparation", { subject: "fix(auth): keep sessions" }, () => {}, /is "fix\(auth\): keep sessions", not "chore: prepare/],
    ["a squash-merged preparation", { subject: `chore: prepare ${tag} (#14)` }, () => {}, /fast-forward/],
    ["a preparation of something that is not a tag", { subject: "chore: prepare the kitchen" }, () => {}, /not "chore: prepare vX/],
    ["a package.json that disagrees", { version: "0.1.0-alpha.6" }, () => {}, /package\.json holds 0\.1\.0-alpha\.6/],
    [
      "a local master ahead of origin's",
      {},
      // The local preparation is not what was merged: origin/master is read, not HEAD.
      (r) => {
        r.git("reset", "-q", "--hard", "HEAD~1");
        r.git("push", "-q", "--force", "origin", "master");
        r.git("commit", "-q", "--allow-empty", "-m", `chore: prepare ${tag}`);
      },
      /is "feat\(inventory\): scan a barcode"/,
    ],
    ["a tag that exists here", {}, (r) => r.git("tag", tag, "HEAD~1"), /already exists here/],
    ["a tag that exists on origin", {}, (r) => r.state.remoteTags.push(tag), /already exists on origin/],
    ["no CI run", {}, (r) => (r.state.ci = null), /no CI push run/],
    ["a CI run still going", {}, (r) => (r.state.ci = { ...green, status: "in_progress", conclusion: "" }), /still in_progress/],
    ["a failed CI run", {}, (r) => (r.state.ci = { ...green, conclusion: "failure" }), /ended failure/],
    ["a run whose image was not published", {}, (r) => (r.state.jobs = jobs({ conclusion: "skipped" })), /"Publish image" is skipped/],
    ["a run without the publish job", {}, (r) => (r.state.jobs = jobs(null)), /"Publish image" is missing/],
    [
      "no signing key",
      {},
      (r) => r.git("config", "--unset", "user.signingkey"),
      /signing is not configured[\s\S]*git config user\.signingkey/,
    ],
    [
      "an SSH key nothing can verify",
      {},
      (r) => r.git("config", "--unset", "gpg.ssh.allowedSignersFile"),
      /git config gpg\.ssh\.allowedSignersFile/,
    ],
  ];

  for (const [label, options, arrange, message] of cases) {
    it(`on ${label}, tagging nothing`, () => {
      const repo = repository(options);
      arrange(repo);
      const tagsBefore = repo.git("tag", "-l");
      const originBefore = repo.originTags();
      expect(repo.run()).toBe(1);
      expect(repo.err.join("\n")).toMatch(/^Refused, nothing tagged: /);
      expect(repo.err.join("\n")).toMatch(message);
      expect(repo.git("tag", "-l")).toBe(tagsBefore);
      expect(repo.originTags()).toBe(originBefore);
      expect(repo.calls.pushed).toEqual([]);
    });
  }

  it("takes no arguments", () => {
    const repo = repository();
    expect(repo.run(tag)).toBe(2);
    expect(repo.err.join("\n")).toContain("usage:");
    expect(repo.git("tag", "-l", tag).trim()).toBe("");
  });
});
