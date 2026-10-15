import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { findCredentialByEmail } from "@/lib/auth/credentials";

/**
 * `20261015120000_credential_accounts` against a database that has accounts in
 * it, which is the only case that matters: an install upgraded from a release
 * that kept the hash on `User`. Every other suite starts from an empty
 * database, where the copy has nothing to copy and the column drop nothing to
 * lose, so a migration that dropped the hashes on the floor would pass them all
 * and sign every existing household out for good.
 *
 * **On a database of its own**, `<test database>_migration`, for the reason
 * `registration.test.ts` gives: this needs the schema as it stood *before* the
 * migration, which the shared database is long past. It is migrated twice —
 * first from a copy of `prisma/` without this migration, then from `prisma/`
 * itself, the way `prisma migrate deploy` meets an upgraded install — and
 * dropped afterwards.
 */

const ROOT = join(import.meta.dir, "../../..");
const MIGRATION = "20261015120000_credential_accounts";
const PASSWORD = "cocina despensa nevera";

function isolatedDatabaseUrl(): { url: string; name: string } {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set; run through `bun run test:integration`.");
  const url = new URL(base);
  const name = `${url.pathname.slice(1)}_migration`;
  // An identifier cannot be a bind parameter, so it is checked instead: this
  // name is interpolated into CREATE and DROP DATABASE below.
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Refusing database name ${JSON.stringify(name)}`);
  url.pathname = `/${name}`;
  return { url: url.toString(), name };
}

function migrate(schema: string, databaseUrl: string): void {
  const run = Bun.spawnSync(
    ["bunx", "--bun", "prisma", "migrate", "deploy", "--schema", schema],
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (run.exitCode !== 0) {
    throw new Error(`prisma migrate deploy (${schema}) failed:\n${run.stdout}\n${run.stderr}`);
  }
}

const isolated = isolatedDatabaseUrl();
const before = mkdtempSync(join(tmpdir(), "stoky-before-credential-accounts-"));
let db: PrismaClient;

/** Two accounts as the release before this one stored them. */
const people = [
  { id: "mig-user-owner", email: "propietaria@example.com" },
  { id: "mig-user-kitchen", email: "cocina@example.com" },
];
let oldHash = "";

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${isolated.name}" WITH (FORCE)`);
  await prisma.$executeRawUnsafe(`CREATE DATABASE "${isolated.name}"`);

  // `prisma/` as it stood the release before: every migration up to this one.
  cpSync(join(ROOT, "prisma"), join(before, "prisma"), {
    recursive: true,
    filter: (source) => !source.includes(MIGRATION),
  });
  migrate(join(before, "prisma", "schema.prisma"), isolated.url);

  db = new PrismaClient({ datasources: { db: { url: isolated.url } } });

  // Raw SQL because the generated client no longer knows the column. One real
  // Argon2id hash for both: what matters is that it survives, byte for byte.
  oldHash = await hashPassword(PASSWORD);
  for (const person of people) {
    await db.$executeRaw`
      INSERT INTO "User" (id, email, name, "passwordHash", "updatedAt")
      VALUES (${person.id}, ${person.email}, 'Antes', ${oldHash}, now())`;
  }

  migrate(join(ROOT, "prisma", "schema.prisma"), isolated.url);
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${isolated.name}" WITH (FORCE)`);
  rmSync(before, { recursive: true, force: true });
});

describe("moving the password hashes into credential Account rows", () => {
  it("gives every existing account exactly one credential row holding its old hash", async () => {
    for (const person of people) {
      const accounts = await db.account.findMany({ where: { userId: person.id } });

      expect(accounts).toHaveLength(1);
      const [account] = accounts;
      expect(account.providerId).toBe("credential");
      expect(account.accountId).toBe(person.id);
      expect(account.password).toBe(oldHash);
      expect(account.id).toBeTruthy();
      expect(account.createdAt).toBeInstanceOf(Date);
      expect(account.updatedAt).toBeInstanceOf(Date);
    }
    expect(await db.account.count()).toBe(people.length);
  });

  it("removes the column from User", async () => {
    const columns = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'User'`;

    expect(columns.map((c) => c.column_name)).not.toContain("passwordHash");
  });

  it("still signs each person in with the password they had before", async () => {
    for (const person of people) {
      const credential = await findCredentialByEmail(db, person.email);

      expect(credential?.user.id).toBe(person.id);
      expect(await verifyPassword(credential?.passwordHash, PASSWORD)).toBe(true);
      expect(await verifyPassword(credential?.passwordHash, `${PASSWORD}!`)).toBe(false);
    }
  });

  it("takes the credential row with the account when the account is deleted", async () => {
    await db.user.delete({ where: { id: people[1].id } });

    expect(await db.account.count({ where: { userId: people[1].id } })).toBe(0);
  });
});
