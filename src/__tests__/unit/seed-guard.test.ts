import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { demoSeedRefusal } from "../../../prisma/seed-guard";

/**
 * The demo seed refuses a production environment.
 *
 * `prisma/seed.ts` creates `demo@stoky.local` as an OWNER with the password the
 * README publishes, and deletes that account's household first. On a database
 * real people use, that is a default credential and data loss, so the seed
 * refuses `NODE_ENV=production` before it reads or writes anything.
 *
 * Two halves. The guard itself, as a function. And the seed as a process,
 * because a guard nothing calls guards nothing: the seed is started against a
 * database that cannot be reached, so the only way to see the refusal rather
 * than a connection error is for the guard to run first.
 */
const ROOT = join(import.meta.dir, "..", "..", "..");

// Port 1 on loopback: nothing listens, so a seed that got past the guard fails
// fast with Prisma's connection error instead of touching a real database.
const UNREACHABLE = "postgresql://nobody:nothing@127.0.0.1:1/none";

function runSeed(nodeEnv: string) {
  const result = Bun.spawnSync([process.execPath, "prisma/seed.ts"], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: nodeEnv, DATABASE_URL: UNREACHABLE },
    timeout: 60_000,
  });
  return { exitCode: result.exitCode, stderr: result.stderr.toString() };
}

describe("demoSeedRefusal", () => {
  it("refuses production", () => {
    expect(demoSeedRefusal({ NODE_ENV: "production" })).toContain(
      "Refusing to seed",
    );
  });

  it("refuses production however it is spelled", () => {
    expect(demoSeedRefusal({ NODE_ENV: " Production " })).not.toBeNull();
    expect(demoSeedRefusal({ NODE_ENV: "PRODUCTION" })).not.toBeNull();
  });

  it("allows development, test and an unset NODE_ENV", () => {
    // `bun run dev`, the integration and e2e seeding paths, and a plain shell.
    expect(demoSeedRefusal({ NODE_ENV: "development" })).toBeNull();
    expect(demoSeedRefusal({ NODE_ENV: "test" })).toBeNull();
    expect(demoSeedRefusal({})).toBeNull();
  });

  it("has no override", () => {
    // The finding suggested an opt-in variable; this module deliberately has
    // none. Any environment variable that let production through would be a
    // way to publish the demo password on a real instance.
    expect(
      demoSeedRefusal({
        NODE_ENV: "production",
        STOKY_ALLOW_DEMO_SEED: "1",
        FORCE: "1",
      }),
    ).not.toBeNull();
  });
});

describe("prisma/seed.ts", () => {
  it("refuses production before it reaches the database", () => {
    const { exitCode, stderr } = runSeed("production");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Refusing to seed: NODE_ENV is production.");
    // Had it got as far as the database, this is what it would have said.
    expect(stderr).not.toContain("Seed failed");
  });

  it("goes on to the database outside production", () => {
    // The control for the test above: the same unreachable database, and the
    // seed gets past the guard and fails on the connection instead.
    const { exitCode, stderr } = runSeed("development");
    expect(exitCode).toBe(1);
    expect(stderr).not.toContain("Refusing to seed");
    expect(stderr).toContain("Seed failed");
    expect(stderr).toContain("Can't reach database server");
  });
});
