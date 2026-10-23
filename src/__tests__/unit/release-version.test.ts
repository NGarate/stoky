import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { breakingHint, increment, isBreaking, nextTag, ReleaseError, resolveTag } from "../../../scripts/release-version";

/**
 * `scripts/release-version.ts` names the tag `release-prepare.ts` cuts. The
 * increments are a table; the refusals that need a repository (a tag that
 * exists, the breaking-change hint) run in a throwaway one written here.
 */

const root = join(import.meta.dir, "../../..");
const fixtures: string[] = [];
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function refusal(action: () => unknown): ReleaseError {
  try {
    action();
  } catch (error) {
    if (error instanceof ReleaseError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("the next release's tag", () => {
  for (const [current, request, expected] of [
    ["0.1.0-alpha.4", "prerelease", "v0.1.0-alpha.5"],
    ["0.1.0-alpha.9", "prerelease", "v0.1.0-alpha.10"],
    ["1.0.0-alpha", "prerelease", "v1.0.0-alpha.1"],
    ["0.1.0-alpha.5", "prepatch", "v0.1.1-alpha.1"],
    ["0.1.0-alpha.5", "preminor", "v0.2.0-alpha.1"],
    ["0.1.0-alpha.5", "premajor", "v1.0.0-alpha.1"],
    ["0.1.0", "prepatch", "v0.1.1-alpha.1"],
    ["0.1.0", "preminor", "v0.2.0-alpha.1"],
    ["0.1.0-alpha.5", "release", "v0.1.0"],
    ["0.1.0-alpha.5", "patch", "v0.1.0"],
    ["0.1.0", "patch", "v0.1.1"],
    ["0.1.0-alpha.5", "minor", "v0.1.0"],
    ["0.1.1-alpha.1", "minor", "v0.2.0"],
    ["0.1.0", "minor", "v0.2.0"],
    ["1.0.0-alpha.2", "major", "v1.0.0"],
    ["0.1.0-alpha.5", "major", "v1.0.0"],
    ["0.1.0", "major", "v1.0.0"],
    ["0.1.0-alpha.4", "v0.3.0", "v0.3.0"],
    ["0.1.0-alpha.4", "0.1.0-alpha.7", "v0.1.0-alpha.7"],
  ] as const) {
    it(`takes ${current} to ${expected} for ${request}`, () => {
      expect(nextTag(current, request)).toBe(expected);
    });
  }

  for (const [label, current, request, message] of [
    ["a prerelease of a stable version", "0.1.0", "prerelease", /prepatch or preminor/],
    ["a release of a release", "0.1.0", "release", /already a release/],
    ["a version that is the current one", "0.1.0-alpha.4", "v0.1.0-alpha.4", /not greater/],
    ["a version below the current one", "0.1.0-alpha.4", "v0.1.0-alpha.3", /not greater/],
    // Another identifier restarts at alpha.1, which sorts before beta.
    ["a prerelease after a beta", "1.0.0-beta.2", "prerelease", /not greater/],
    ["a version with build metadata", "0.1.0-alpha.4", "v0.2.0+build.1", /release-assets\.sh accepts/],
    ["a version with an empty prerelease", "0.1.0-alpha.4", "v0.2.0-", /release-assets\.sh accepts/],
    ["a version with a fourth number", "0.1.0-alpha.4", "v0.2.0.1", /release-assets\.sh accepts/],
  ] as const) {
    it(`refuses ${label}`, () => {
      const error = refusal(() => nextTag(current, request));
      expect(error.exitCode).toBe(1);
      expect(error.message).toMatch(message);
    });
  }

  it("calls an unknown request a usage error", () => {
    const error = refusal(() => nextTag("0.1.0-alpha.4", "next"));
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain("usage:");
  });

  it("starts every new prerelease series at 1", () => {
    for (const bump of ["prepatch", "preminor", "premajor"] as const) {
      expect(increment("0.1.0-alpha.5", bump)).toEndWith("-alpha.1");
    }
  });
});

describe("the breaking-change hint", () => {
  it("knows the markers release-notes.ts lists as breaking", () => {
    expect(isBreaking("feat(auth)!: drop the session table", "")).toBe(true);
    expect(isBreaking("feat!: drop it", "")).toBe(true);
    expect(isBreaking("fix(auth): keep sessions", "Some text.\n\nBREAKING CHANGE: the secret is renamed.")).toBe(true);
    expect(isBreaking("feat(auth): keep sessions", "Breaking change: in prose, not a footer.")).toBe(false);
    expect(isBreaking("feat(auth): a ! inside the subject!", "")).toBe(false);
  });

  it("speaks only for small bumps over breaking commits", () => {
    const breaking = ["abc1234 feat!: drop it"];
    for (const bump of ["patch", "prepatch", "prerelease"]) {
      expect(breakingHint(bump, "0.1.0-alpha.4", breaking)).toMatch(/usually takes a minor/);
    }
    for (const bump of ["preminor", "minor", "premajor", "major", "release", "v0.2.0"]) {
      expect(breakingHint(bump, "0.1.0-alpha.4", breaking)).toBeNull();
    }
    expect(breakingHint("patch", "0.1.0-alpha.4", [])).toBeNull();
    expect(breakingHint("patch", "1.2.0", breaking)).toMatch(/usually takes a major/);
  });
});

function repository(version = "0.1.0-alpha.4") {
  const dir = mkdtempSync(join(tmpdir(), "stoky-version-"));
  fixtures.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: gitEnv });
  git("init", "-q", "-b", "master");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version }));
  git("add", "package.json");
  git("commit", "-q", "--no-gpg-sign", "-m", "chore: prepare v0.1.0-alpha.4");
  git("tag", "v0.1.0-alpha.4");
  const commit = (message: string) => git("commit", "-q", "--allow-empty", "--no-gpg-sign", "-m", message);
  return { dir, git, commit };
}

describe("resolving a tag in a repository", () => {
  const asked: string[] = [];
  const deps = (cwd: string, remote: string[] = []) => ({
    cwd,
    remoteTagExists: (tag: string) => {
      asked.push(tag);
      return remote.includes(tag);
    },
  });

  it("returns the tag, the previous one and no hint after ordinary commits", () => {
    const { dir, commit } = repository();
    commit("feat(inventory): scan a barcode");
    asked.length = 0;
    expect(resolveTag("prerelease", deps(dir))).toEqual({
      tag: "v0.1.0-alpha.5",
      current: "0.1.0-alpha.4",
      previous: "v0.1.0-alpha.4",
      hint: null,
    });
    expect(asked).toEqual(["v0.1.0-alpha.5"]);
  });

  it("refuses a tag that already exists here", () => {
    const { dir, git } = repository();
    git("tag", "v0.1.0-alpha.5");
    expect(refusal(() => resolveTag("prerelease", deps(dir))).message).toContain("already exists here");
  });

  it("refuses a tag that already exists on origin", () => {
    const { dir } = repository();
    expect(refusal(() => resolveTag("prerelease", deps(dir, ["v0.1.0-alpha.5"]))).message).toContain(
      "already exists on origin",
    );
  });

  it("hints when a breaking commit ships under a prerelease", () => {
    const { dir, commit } = repository();
    commit("feat(auth)!: drop the old sessions");
    const { hint } = resolveTag("prerelease", deps(dir));
    expect(hint).toContain("feat(auth)!: drop the old sessions");
    expect(hint).toContain("usually takes a minor");
    expect(resolveTag("preminor", deps(dir)).hint).toBeNull();
  });

  it("prints only the tag on stdout, and the hint on stderr", () => {
    const { dir, git, commit } = repository();
    mkdirSync(join(dir, "scripts"));
    copyFileSync(join(root, "scripts/release-version.ts"), join(dir, "scripts/release-version.ts"));
    commit("fix(auth): rename the secret\n\nBREAKING CHANGE: STOKY_SECRET replaces AUTH_SECRET.");
    // An origin that has nothing, so the remote question has an answer.
    const origin = mkdtempSync(join(tmpdir(), "stoky-version-origin-"));
    fixtures.push(origin);
    execFileSync("git", ["init", "-q", "--bare", origin], { env: gitEnv });
    git("remote", "add", "origin", origin);
    const result = Bun.spawnSync(["bun", "scripts/release-version.ts", "prerelease"], { cwd: dir, env: gitEnv });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("v0.1.0-alpha.5\n");
    expect(result.stderr.toString()).toContain("usually takes a minor");

    // A tag already on origin is refused with exit 1 and nothing on stdout.
    git("tag", "v0.1.0-alpha.5");
    git("push", "-q", "origin", "v0.1.0-alpha.5");
    git("tag", "-d", "v0.1.0-alpha.5");
    const refused = Bun.spawnSync(["bun", "scripts/release-version.ts", "prerelease"], { cwd: dir, env: gitEnv });
    expect(refused.exitCode).toBe(1);
    expect(refused.stdout.toString()).toBe("");
    expect(refused.stderr.toString()).toContain("already exists on origin");
  });

  it("calls a repository with no origin to ask an error, not a free tag", () => {
    const { dir } = repository();
    mkdirSync(join(dir, "scripts"));
    copyFileSync(join(root, "scripts/release-version.ts"), join(dir, "scripts/release-version.ts"));
    const result = Bun.spawnSync(["bun", "scripts/release-version.ts", "prerelease"], { cwd: dir, env: gitEnv });
    expect(result.exitCode).toBe(2);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toContain("Could not ask origin");
  });
});
