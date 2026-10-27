import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { openTestSession, storedPasswordHash } from "../utils/test-helpers";
import {
  createCredentialUser,
  readPasswordHash,
  setPasswordAndEndSessions,
} from "@/lib/auth/credentials";

/**
 * `src/lib/auth/credentials.ts` is the one module that knows where a password
 * hash is stored: Better Auth's credential Account row (PROGRESS D134). These
 * tests are what that has to keep true: an account made through the module
 * signs in through it, its hash sits in the row Better Auth reads, and a
 * guarded password write lands on nobody who has stopped matching the guard.
 *
 * Each hash here is a real 64 MiB Argon2id run, so the file keeps them few.
 */

const RUN = `cred-${process.pid}-${Date.now().toString(36)}`;
const PASSWORD = "cocina despensa nevera";
const NEW_PASSWORD = "nevera alacena despensa";

let householdId = "";

beforeAll(async () => {
  householdId = (
    await prisma.household.create({ data: { name: `Credentials ${RUN}` } })
  ).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  await prisma.household.deleteMany({ where: { id: householdId } });
  await prisma.$disconnect();
});

describe("an account made through the credentials module", () => {
  it("keeps a hash its password verifies against", async () => {
    const email = `${RUN}.signin@example.com`;
    const created = await createCredentialUser(
      prisma,
      { email, name: "Cocina", householdId, role: "MEMBER" },
      await hashPassword(PASSWORD),
    );

    const passwordHash = await readPasswordHash(prisma, created.id);

    expect(await verifyPassword(passwordHash, PASSWORD)).toBe(true);
    expect(await verifyPassword(passwordHash, NEW_PASSWORD)).toBe(false);
  });

  it("keeps the hash in one credential Account row keyed on the user's own id", async () => {
    const hash = await hashPassword(PASSWORD);
    const created = await createCredentialUser(
      prisma,
      {
        email: `${RUN}.row@example.com`,
        name: "Fila",
        householdId,
        role: "MEMBER",
      },
      hash,
    );

    const accounts = await prisma.account.findMany({
      where: { userId: created.id },
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      providerId: "credential",
      accountId: created.id,
      password: hash,
    });
    expect(await storedPasswordHash(created.id)).toBe(hash);
  });

  it("finds no credential for an account that has no credential row", async () => {
    // A user made some other way — a script, or a sign-in method added later —
    // has nothing to check a password against, and must read as no account.
    const bare = await prisma.user.create({
      data: {
        email: `${RUN}.bare@example.com`,
        name: "Sin clave",
        householdId,
      },
    });

    expect(await readPasswordHash(prisma, bare.id)).toBeNull();
  });

  it("answers null for an id with no account", async () => {
    expect(await readPasswordHash(prisma, `${RUN}-no-such-id`)).toBeNull();
  });
});

describe("setPasswordAndEndSessions", () => {
  it("writes nothing to an account whose role no longer matches the guard", async () => {
    const original = await hashPassword(PASSWORD);
    const member = await createCredentialUser(
      prisma,
      {
        email: `${RUN}.guarded@example.com`,
        name: "Miembro",
        householdId,
        role: "MEMBER",
      },
      original,
    );
    await openTestSession(member.id);
    // Promoted after the caller checked it, while the new hash was being made.
    await prisma.user.update({
      where: { id: member.id },
      data: { role: "OWNER" },
    });

    const written = await setPasswordAndEndSessions(
      prisma,
      { userId: member.id, guard: { householdId, role: "MEMBER" } },
      await hashPassword(NEW_PASSWORD),
    );

    expect(written).toBe(0);
    expect(await prisma.session.count({ where: { userId: member.id } })).toBe(
      1,
    );
    expect(await readPasswordHash(prisma, member.id)).toBe(original);
  });

  it("sets the hash and ends the sessions in one write when the guard holds", async () => {
    const member = await createCredentialUser(
      prisma,
      {
        email: `${RUN}.reset@example.com`,
        name: "Miembro",
        householdId,
        role: "MEMBER",
      },
      await hashPassword(PASSWORD),
    );
    await openTestSession(member.id);
    await openTestSession(member.id);

    const written = await setPasswordAndEndSessions(
      prisma,
      { userId: member.id, guard: { householdId, role: "MEMBER" } },
      await hashPassword(NEW_PASSWORD),
    );

    expect(written).toBe(1);
    expect(await prisma.session.count({ where: { userId: member.id } })).toBe(
      0,
    );
    const passwordHash = await readPasswordHash(prisma, member.id);
    expect(await verifyPassword(passwordHash, NEW_PASSWORD)).toBe(true);
  });
});
