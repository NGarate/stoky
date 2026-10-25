import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `prisma.config.ts` must load `.env` itself.
 *
 * The moment that file exists, the Prisma CLI stops reading `.env` on its own
 * ("Prisma config detected, skipping environment variable loading") — so every
 * `prisma migrate`/`db push`/`validate` fails with a missing DATABASE_URL
 * unless the config file takes over that job. Nothing else exercises this:
 * `bun run dev` and the test suites get their environment from Next.js or Bun,
 * both of which load `.env` regardless. Only the Prisma CLI takes this path.
 *
 * These tests spawn `node`, not `bun`, deliberately: Bun auto-loads `.env`
 * from the working directory, which would set DATABASE_URL whether or not the
 * config did — a test that cannot fail. Node loads nothing on its own.
 */

const CONFIG = join(import.meta.dir, "../../../prisma.config.ts");

let dirWithEnv: string;
let dirWithoutEnv: string;

beforeAll(() => {
  dirWithEnv = mkdtempSync(join(tmpdir(), "stoky-prisma-config-"));
  writeFileSync(
    join(dirWithEnv, ".env"),
    "DATABASE_URL=postgres://from-dotenv-file\n",
  );
  dirWithoutEnv = mkdtempSync(join(tmpdir(), "stoky-prisma-config-"));
});

afterAll(() => {
  rmSync(dirWithEnv, { recursive: true, force: true });
  rmSync(dirWithoutEnv, { recursive: true, force: true });
});

/** Import the config under node in `cwd` and report what DATABASE_URL became. */
function importConfig(cwd: string, extraEnv: Record<string, string> = {}) {
  // Strip the developer's real DATABASE_URL so only the test controls it.
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.DATABASE_URL;
  Object.assign(env, extraEnv);

  const script = `import(${JSON.stringify(CONFIG)}).then(
    () => console.log("DATABASE_URL=" + (process.env.DATABASE_URL ?? "<unset>")),
    (e) => { console.error(e); process.exit(1); },
  )`;
  const child = Bun.spawnSync(["node", "-e", script], { cwd, env });
  return {
    exitCode: child.exitCode,
    stdout: child.stdout.toString(),
    stderr: child.stderr.toString(),
  };
}

describe("prisma.config.ts", () => {
  it("loads DATABASE_URL from .env in the working directory", () => {
    // The assertion this file exists for. If the config stops loading .env,
    // every Prisma CLI command breaks on developer machines.
    const run = importConfig(dirWithEnv);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("DATABASE_URL=postgres://from-dotenv-file");
  });

  it("lets a real environment variable win over the file", () => {
    // CI provides DATABASE_URL directly, pointing at its own service
    // container. The .env fallback must never shadow it.
    const run = importConfig(dirWithEnv, {
      DATABASE_URL: "postgres://from-real-env",
    });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("DATABASE_URL=postgres://from-real-env");
  });

  it("imports cleanly when no .env exists", () => {
    // CI has no .env at all; the config must not throw there.
    const run = importConfig(dirWithoutEnv);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("DATABASE_URL=<unset>");
  });
});
