import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

const gitEnv = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function repo() {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-install-hooks-"));
  fixtures.push(fixture);
  mkdirSync(join(fixture, "scripts"));
  copyFileSync(join(root, "scripts/install-hooks.sh"), join(fixture, "scripts/install-hooks.sh"));
  // Stands in for the real checks: records how it was called, and fails when
  // asked to, so a commit can be seen going through or being stopped.
  writeFileSync(join(fixture, "scripts/check-scope.sh"), 'echo "$*" >> "$CALLS"\nexit "${SCOPE_EXIT:-0}"\n');
  const callsPath = join(fixture, "calls");
  writeFileSync(callsPath, "");

  const spawn = (cmd: string[], extra: Record<string, string> = {}) => {
    const result = Bun.spawnSync(cmd, { cwd: fixture, env: { ...process.env, ...gitEnv, CALLS: callsPath, ...extra } });
    return { exitCode: result.exitCode, stderr: result.stderr.toString() };
  };
  spawn(["git", "init", "-q", "-b", "master"]);
  const hook = join(fixture, ".git/hooks/pre-commit");

  return {
    fixture,
    hook,
    install: (...args: string[]) => spawn(["bash", "scripts/install-hooks.sh", ...args]),
    commit: (scopeExit = 0) => {
      writeFileSync(join(fixture, `file-${Math.random()}`), "x\n");
      spawn(["git", "add", "."]);
      return spawn(["git", "commit", "-q", "-m", "change"], { SCOPE_EXIT: String(scopeExit) });
    },
    calls: () => readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean),
  };
}

describe("install-hooks.sh", () => {
  it("installs nothing until asked", () => {
    const r = repo();
    expect(r.commit().exitCode).toBe(0);
    expect(r.calls()).toEqual([]);
  });

  it("makes every commit run the staged checks, and a failure stop it", () => {
    const r = repo();
    expect(r.install().exitCode).toBe(0);
    expect(r.commit().exitCode).toBe(0);
    expect(r.calls()).toEqual(["staged"]);
    expect(r.commit(1).exitCode).not.toBe(0);
    expect(r.calls()).toEqual(["staged", "staged"]);
  });

  it("can be installed twice and removed again", () => {
    const r = repo();
    expect(r.install().exitCode).toBe(0);
    expect(r.install().exitCode).toBe(0);
    expect(r.install("--uninstall").exitCode).toBe(0);
    expect(existsSync(r.hook)).toBe(false);
    expect(r.commit().exitCode).toBe(0);
    expect(r.calls()).toEqual([]);
  });

  it("leaves a pre-commit hook it did not write alone", () => {
    const r = repo();
    mkdirSync(join(r.fixture, ".git/hooks"), { recursive: true });
    writeFileSync(r.hook, "#!/bin/sh\necho mine\n", { mode: 0o755 });
    const install = r.install();
    expect(install.exitCode).toBe(1);
    expect(install.stderr).toContain("was not written by this script");
    expect(r.install("--uninstall").exitCode).toBe(1);
    expect(readFileSync(r.hook, "utf8")).toBe("#!/bin/sh\necho mine\n");
  });

  it("installs where core.hooksPath points", () => {
    const r = repo();
    Bun.spawnSync(["git", "config", "core.hooksPath", "custom-hooks"], { cwd: r.fixture, env: { ...process.env, ...gitEnv } });
    expect(r.install().exitCode).toBe(0);
    expect(existsSync(join(r.fixture, "custom-hooks/pre-commit"))).toBe(true);
    expect(r.commit().exitCode).toBe(0);
    expect(r.calls()).toEqual(["staged"]);
  });
});
