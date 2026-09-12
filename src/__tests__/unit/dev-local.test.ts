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

function setup(existingModules: boolean, installExit = 0, pnpm = false) {
  const fixture = mkdtempSync(join(tmpdir(), "stoky-dev-setup-"));
  fixtures.push(fixture);
  mkdirSync(join(fixture, "scripts"));
  mkdirSync(join(fixture, "bin"));
  if (existingModules) mkdirSync(join(fixture, "node_modules"));
  const pnpmMarker = join(fixture, "node_modules/.modules.yaml");
  if (pnpm) writeFileSync(pnpmMarker, "packageManager: pnpm\n");
  copyFileSync(join(root, "scripts/dev-local.sh"), join(fixture, "scripts/dev-local.sh"));
  copyFileSync(join(root, ".bun-version"), join(fixture, ".bun-version"));
  writeFileSync(join(fixture, ".env"), "");
  writeFileSync(join(fixture, "docker-compose.dev.yml"), "");

  const command = (name: string, body: string) => {
    writeFileSync(join(fixture, "bin", name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  };
  command("docker", `case "$*" in
    --version) echo 'Docker test fixture' ;;
    *' ps '*) echo '{"Health":"healthy"}' ;;
  esac`);
  command("bun", `if [ "$1" = --version ]; then cat .bun-version; exit; fi
    echo "bun $*" >> "$SETUP_CALLS"
    if [ "$1" = install ]; then exit "$INSTALL_EXIT"; fi`);
  command("bunx", 'echo "bunx $*" >> "$SETUP_CALLS"');

  const callsPath = join(fixture, "calls");
  writeFileSync(callsPath, "");
  const result = Bun.spawnSync(["bash", "scripts/dev-local.sh", "--no-app"], {
    cwd: fixture,
    env: {
      ...process.env,
      PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
      SETUP_CALLS: callsPath,
      INSTALL_EXIT: String(installExit),
    },
  });
  return {
    exitCode: result.exitCode,
    calls: readFileSync(callsPath, "utf8").trim().split("\n"),
    pnpmMarker: existsSync(pnpmMarker),
  };
}

describe("local bootstrap dependency installation", () => {
  for (const existingModules of [false, true]) {
    it(`installs the locked dependencies before Prisma with node_modules ${existingModules ? "present" : "absent"}`, () => {
      const result = setup(existingModules);
      expect(result.exitCode).toBe(0);
      expect(result.calls).toEqual([
        "bun install --frozen-lockfile",
        "bunx prisma generate",
        "bunx prisma migrate dev",
      ]);
    });
  }

  it("stops before migrations when the frozen install fails", () => {
    const result = setup(true, 1);
    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual(["bun install --frozen-lockfile"]);
  });

  it("replaces pnpm links before generating Prisma and retires its marker", () => {
    const result = setup(true, 0, true);
    expect(result.exitCode).toBe(0);
    expect(result.calls).toEqual([
      "bun install --frozen-lockfile --force",
      "bunx prisma generate",
      "bunx prisma migrate dev",
    ]);
    expect(result.pnpmMarker).toBe(false);
  });

  it("keeps the pnpm marker and stops when conversion fails", () => {
    const result = setup(true, 1, true);
    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual(["bun install --frozen-lockfile --force"]);
    expect(result.pnpmMarker).toBe(true);
  });
});
