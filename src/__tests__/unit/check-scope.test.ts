import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// Each stub logs one line per call, every argument in brackets, so a path with
// a space in it stays one argument in the assertion.
const logger = (name: string) => `{ printf '${name}'; printf ' [%s]' "$@"; printf '\\n'; } >> "$CALLS"`;

const gitEnv = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function repo() {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-check-scope-"));
  fixtures.push(fixture);
  mkdirSync(join(fixture, "scripts"));
  mkdirSync(join(fixture, "bin"));
  copyFileSync(join(root, "scripts/check-scope.sh"), join(fixture, "scripts/check-scope.sh"));
  // check-ci.sh stands in for actionlint, shellcheck and zizmor: what check-scope.sh
  // owes them is the right file list, and that is what it receives.
  writeFileSync(join(fixture, "scripts/check-ci.sh"), `#!/bin/bash\n${logger("check-ci")}\n`);
  writeFileSync(
    join(fixture, "bin/bun"),
    `#!/bin/bash\n${logger("bun")}\nif [ -n "$FAIL" ] && [[ "$*" == *"$FAIL"* ]]; then exit "$FAIL_CODE"; fi\n`,
    { mode: 0o755 },
  );
  const callsPath = join(fixture, "calls");

  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: fixture, env: { ...process.env, ...gitEnv } });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.toString().trim();
  };
  // Distinct contents by default: identical files let git pair a deletion
  // with an addition as a rename, and the deletion then never shows.
  const write = (path: string, content = `${path}\n`) => {
    mkdirSync(join(fixture, dirname(path)), { recursive: true });
    writeFileSync(join(fixture, path), content);
  };

  git("init", "-q", "-b", "master");
  for (const path of ["src/old.ts", "src/gone.tsx", "src/shared.ts", "scripts/stable.sh", "README.md"]) write(path);
  git("add", ".");
  git("commit", "-q", "-m", "base");

  const run = (args: string[], fail = "", failCode = 3) => {
    writeFileSync(callsPath, "");
    const result = Bun.spawnSync(["bash", "scripts/check-scope.sh", ...args], {
      cwd: fixture,
      env: {
        ...process.env,
        ...gitEnv,
        PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
        CALLS: callsPath,
        FAIL: fail,
        FAIL_CODE: String(failCode),
      },
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      calls: readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean),
    };
  };

  return { git, write, run };
}

// One file of every kind each check cares about, one it does not, one in a
// directory `all` never lints, and a deletion.
function stageMixedChange(fixture: ReturnType<typeof repo>) {
  fixture.write("src/new file.tsx");
  fixture.write("src/old.ts", "y\n");
  fixture.write(".github/workflows/ci.yml");
  fixture.write(".github/dependabot.yml");
  fixture.write(".github/selected-actions.json");
  fixture.write("scripts/release.sh");
  fixture.write("deploy/install.sh");
  fixture.write("deploy/examples/old.sh");
  fixture.write("docs/repro.sh");
  fixture.write("docs/notes.md");
  fixture.git("rm", "-q", "src/gone.tsx");
  fixture.git("add", ".");
}

describe("check-scope.sh", () => {
  it("runs every check over everything for `all`", () => {
    const result = repo().run(["all"]);
    expect(result.exitCode).toBe(0);
    expect(result.calls).toEqual([
      "bun [run] [lint]",
      "bun [run] [check:react] [--scope] [full]",
      "check-ci [actionlint]",
      "check-ci [shellcheck]",
      "check-ci [zizmor]",
      "bun [run] [check:audit]",
      "bun [run] [typecheck]",
    ]);
  });

  it("gives each tool only the staged files it covers for `staged`", () => {
    const fixture = repo();
    stageMixedChange(fixture);
    const result = fixture.run(["staged"]);
    expect(result.exitCode).toBe(0);
    expect(result.calls).toEqual([
      "bun [run] [lint] [src/new file.tsx] [src/old.ts]",
      "bun [run] [check:react] [--staged]",
      "check-ci [actionlint] [.github/workflows/ci.yml]",
      "check-ci [shellcheck] [deploy/install.sh] [scripts/release.sh]",
      "check-ci [zizmor] [.github/dependabot.yml] [.github/workflows/ci.yml]",
      "bun [run] [typecheck]",
    ]);
  });

  it("ignores what is modified but not staged", () => {
    const fixture = repo();
    fixture.write("src/old.ts", "unstaged\n");
    const result = fixture.run(["staged"]);
    expect(result.calls).toEqual(["bun [run] [typecheck]"]);
  });

  it("compares committed and uncommitted work with the merge base for `changed`", () => {
    const fixture = repo();
    const base = fixture.git("rev-parse", "HEAD");
    fixture.git("checkout", "-q", "-b", "topic");
    stageMixedChange(fixture);
    fixture.git("commit", "-q", "-m", "topic");
    // master moves on after the branch is cut; its changes are not ours.
    fixture.git("checkout", "-q", "master");
    fixture.write("src/theirs.ts");
    fixture.write("src/shared.ts", "theirs\n");
    fixture.git("add", ".");
    fixture.git("commit", "-q", "-m", "theirs");
    const masterTip = fixture.git("rev-parse", "HEAD");
    fixture.git("checkout", "-q", "topic");
    // Staged and unstaged edits count; an untracked file does not, as in
    // React Doctor's own changed scope.
    fixture.write("scripts/uncommitted.sh");
    fixture.git("add", "scripts/uncommitted.sh");
    fixture.write("scripts/stable.sh", "edited, not staged\n");
    fixture.write("scripts/untracked.sh");

    const result = fixture.run(["changed", "--base", masterTip]);
    expect(result.exitCode).toBe(0);
    expect(result.calls).toEqual([
      "bun [run] [lint] [src/new file.tsx] [src/old.ts]",
      `bun [run] [check:react] [--scope] [changed] [--base] [${base}]`,
      "check-ci [actionlint] [.github/workflows/ci.yml]",
      "check-ci [shellcheck] [deploy/install.sh] [scripts/release.sh] [scripts/stable.sh] [scripts/uncommitted.sh]",
      "check-ci [zizmor] [.github/dependabot.yml] [.github/workflows/ci.yml]",
      "bun [run] [typecheck]",
    ]);
  });

  it("defaults the base to origin/master, not the local master", () => {
    // Half the branch has already landed upstream; the local master is stale.
    const fixture = repo();
    fixture.git("checkout", "-q", "-b", "topic");
    fixture.write("src/landed.ts");
    fixture.git("add", ".");
    fixture.git("commit", "-q", "-m", "landed");
    const landed = fixture.git("rev-parse", "HEAD");
    fixture.git("update-ref", "refs/remotes/origin/master", landed);
    fixture.write("src/topic.ts");
    fixture.git("add", ".");
    fixture.git("commit", "-q", "-m", "topic");

    const result = fixture.run(["changed"]);
    expect(result.calls[0]).toBe("bun [run] [lint] [src/topic.ts]");
    expect(result.calls[1]).toBe(`bun [run] [check:react] [--scope] [changed] [--base] [${landed}]`);
  });

  it("fetches origin/master when the clone has never seen it", () => {
    const fixture = repo();
    const remote = mkdtempSync(join(tmpdir(), "stoky-check-scope-origin-"));
    fixtures.push(remote);
    Bun.spawnSync(["git", "init", "-q", "--bare", remote], { env: { ...process.env, ...gitEnv } });
    fixture.git("remote", "add", "origin", remote);
    fixture.git("push", "-q", "origin", "master");
    fixture.git("update-ref", "-d", "refs/remotes/origin/master");
    fixture.git("checkout", "-q", "-b", "topic");
    fixture.write("src/topic.ts");
    fixture.git("add", ".");
    fixture.git("commit", "-q", "-m", "topic");

    const result = fixture.run(["changed"]);
    expect(result.exitCode).toBe(0);
    expect(result.calls[0]).toBe("bun [run] [lint] [src/topic.ts]");
  });

  it("reports an empty file list as skipped, not as a pass", () => {
    const result = repo().run(["staged"]);
    expect(result.exitCode).toBe(0);
    expect(result.calls).toEqual(["bun [run] [typecheck]"]);
    for (const check of ["oxlint", "React Doctor", "actionlint", "shellcheck", "zizmor"]) {
      expect(result.stdout).toContain(`skipped  ${check}: no staged`);
      expect(result.stdout).not.toContain(`ok       ${check}`);
    }
    expect(result.stdout).toContain("skipped  dependency audit: no dependency change");
    expect(result.stdout).toContain("ok       typecheck");
  });

  it("keeps going after a failure, then fails", () => {
    const fixture = repo();
    stageMixedChange(fixture);
    const result = fixture.run(["staged"], "check:react");
    expect(result.exitCode).toBe(1);
    expect(result.calls).toHaveLength(6);
    expect(result.stdout).toContain("FAILED   React Doctor (exit 3)");
    expect(result.stdout).toContain("ok       typecheck");
  });

  for (const manifest of ["bun.lock", "package.json"]) {
    it(`audits the dependencies when ${manifest} is staged`, () => {
      const fixture = repo();
      fixture.write(manifest);
      fixture.git("add", ".");
      const result = fixture.run(["staged"]);
      expect(result.calls).toEqual(["bun [run] [check:audit]", "bun [run] [typecheck]"]);
    });
  }

  it("does not audit when no dependency changed", () => {
    const fixture = repo();
    fixture.write("src/only.tsx");
    fixture.git("add", ".");
    const result = fixture.run(["staged"]);
    expect(result.calls).not.toContain("bun [run] [check:audit]");
    expect(result.stdout).toContain("skipped  dependency audit: no dependency change");
  });

  it("reports an audit that could not reach the network as skipped, and passes", () => {
    const result = repo().run(["all"], "check:audit", 75);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("skipped  dependency audit: offline");
  });

  it("leaves actionlint, shellcheck and zizmor to check-ci.sh with --no-pipeline-lint", () => {
    const fixture = repo();
    stageMixedChange(fixture);
    for (const scope of ["all", "staged"]) {
      const result = fixture.run([scope, "--no-pipeline-lint"]);
      expect(result.exitCode).toBe(0);
      expect(result.calls.filter((call) => call.startsWith("check-ci"))).toEqual([]);
      expect(result.stdout).toContain("skipped  actionlint: --no-pipeline-lint");
      expect(result.stdout).toContain("skipped  shellcheck: --no-pipeline-lint");
      expect(result.stdout).toContain("skipped  zizmor: --no-pipeline-lint");
    }
  });

  it("refuses an unknown scope, and --base outside `changed`", () => {
    const fixture = repo();
    expect(fixture.run(["everything"]).exitCode).toBe(2);
    expect(fixture.run(["staged", "--base", "HEAD"]).exitCode).toBe(2);
    expect(fixture.run([]).exitCode).toBe(2);
  });

  it("sends React Doctor through check:react, which carries the shared flags", () => {
    // Every scope above calls `bun run check:react`, so this is the one place a
    // flag can be lost. Without --no-supply-chain the dependency list goes to
    // Socket.dev, and without --blocking error a finding does not fail.
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const flags = pkg.scripts["check:react"].split(" ");
    for (const flag of ["--no-telemetry", "--no-supply-chain", "--no-warnings"]) {
      expect(flags).toContain(flag);
    }
    expect(flags[flags.indexOf("--blocking") + 1]).toBe("error");
  });
});

describe("check-audit.sh", () => {
  function audit(output: string, exitCode: number) {
    const fixture = mkdtempSync(join(tmpdir(), "stoky-check-audit-"));
    fixtures.push(fixture);
    mkdirSync(join(fixture, "scripts"));
    mkdirSync(join(fixture, "bin"));
    copyFileSync(join(root, "scripts/check-audit.sh"), join(fixture, "scripts/check-audit.sh"));
    writeFileSync(join(fixture, "bin/bun"), `#!/bin/bash\necho "$*" > args\nprintf '%s\\n' "$OUTPUT" >&2\nexit ${exitCode}\n`, {
      mode: 0o755,
    });
    const result = Bun.spawnSync(["bash", "scripts/check-audit.sh"], {
      cwd: fixture,
      env: { ...process.env, PATH: `${join(fixture, "bin")}:${process.env.PATH}`, OUTPUT: output },
    });
    return { exitCode: result.exitCode, args: readFileSync(join(fixture, "args"), "utf8").trim() };
  }

  it("audits at the moderate level and passes a clean tree", () => {
    expect(audit("No vulnerabilities found (checked 564 packages)", 0)).toEqual({
      exitCode: 0,
      args: "audit --audit-level moderate",
    });
  });

  it("fails on a vulnerable tree", () => {
    expect(audit("lodash  <4.17.21\n  high: Prototype Pollution", 1).exitCode).toBe(1);
  });

  it("exits 75 when the advisory endpoint cannot be reached", () => {
    const offline = "error: POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - DNSResolveFailed";
    expect(audit(offline, 1).exitCode).toBe(75);
  });
});

describe("check-ci.sh file arguments", () => {
  // Offline, the regular persona, and an unparseable workflow is a failure
  // rather than a file quietly left out of the audit.
  const zizmorFlags = "[--offline] [--persona] [regular] [--strict-collection] [--no-progress] [--color] [never]";

  function runCheckCi(args: string[], options: { deploy?: boolean } = {}) {
    const fixture = mkdtempSync(join(tmpdir(), "stoky-check-ci-"));
    fixtures.push(fixture);
    mkdirSync(join(fixture, "scripts"));
    mkdirSync(join(fixture, "bin"));
    if (options.deploy) {
      mkdirSync(join(fixture, "deploy"));
      writeFileSync(join(fixture, "deploy/install.sh"), "");
    }
    copyFileSync(join(root, "scripts/check-ci.sh"), join(fixture, "scripts/check-ci.sh"));
    for (const name of ["a.sh", "b.sh"]) writeFileSync(join(fixture, "scripts", name), "");
    writeFileSync(join(fixture, "bin/docker"), `#!/bin/bash\n[ "$1" = info ] && exit 0\n${logger("docker")}\n`, {
      mode: 0o755,
    });
    const callsPath = join(fixture, "calls");
    writeFileSync(callsPath, "");
    const result = Bun.spawnSync(["bash", "scripts/check-ci.sh", ...args], {
      cwd: fixture,
      env: { ...process.env, PATH: `${join(fixture, "bin")}:${process.env.PATH}`, CALLS: callsPath, CHECK_CI_TOOLS: "" },
    });
    // The tool and what follows the image; the mount and user flags vary.
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean);
    return {
      exitCode: result.exitCode,
      calls,
      tools: calls.map((call) => call.replace(/^.*\[--entrypoint\] \[([^\]]+)\] \[[^\]]+\]/, "$1")),
    };
  }

  it("lints everything with no arguments", () => {
    const result = runCheckCi([]);
    expect(result.exitCode).toBe(0);
    expect(result.tools).toEqual([
      "/usr/local/bin/actionlint [-no-color]",
      "shellcheck [-S] [warning] [scripts/a.sh] [scripts/b.sh] [scripts/check-ci.sh]",
      `/usr/bin/zizmor ${zizmorFlags} [.github]`,
    ]);
  });

  it("runs zizmor from its own pinned image, offline", () => {
    const [call] = runCheckCi(["zizmor"]).calls;
    expect(call).toContain("[--network] [none]");
    expect(call).toMatch(/\[ghcr\.io\/zizmorcore\/zizmor:[\d.]+@sha256:[0-9a-f]{64}\]/);
  });

  it("lints the operator's install script beside the project's own", () => {
    expect(runCheckCi(["shellcheck"], { deploy: true }).tools).toEqual([
      "shellcheck [-S] [warning] [scripts/a.sh] [scripts/b.sh] [scripts/check-ci.sh] [deploy/install.sh]",
    ]);
  });

  it("runs only the named tool, over only the named files", () => {
    expect(runCheckCi(["shellcheck", "scripts/b.sh"]).tools).toEqual(["shellcheck [-S] [warning] [scripts/b.sh]"]);
    expect(runCheckCi(["actionlint", ".github/workflows/x.yml"]).tools).toEqual([
      "/usr/local/bin/actionlint [-no-color] [.github/workflows/x.yml]",
    ]);
    expect(runCheckCi(["zizmor", ".github/dependabot.yml"]).tools).toEqual([
      `/usr/bin/zizmor ${zizmorFlags} [.github/dependabot.yml]`,
    ]);
    expect(runCheckCi(["zizmor"]).tools).toEqual([`/usr/bin/zizmor ${zizmorFlags} [.github]`]);
  });
});
