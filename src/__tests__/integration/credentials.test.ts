import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import {
  createCredentialUser,
  findCredentialByEmail,
  readPasswordHash,
  setPasswordAndEndSessions,
} from "@/lib/auth/credentials";

/**
 * `src/lib/auth/credentials.ts` is the one module that knows where a password
 * hash is stored, so the move of that hash into Better Auth's credential
 * Account row changes it and nothing else. These tests are what that move has
 * to keep true: an account made through the module signs in through it, and a
 * guarded password write lands on nobody who has stopped matching the guard.
 *
 * Each hash here is a real 64 MiB Argon2id run, so the file keeps them few.
 */

const RUN = `cred-${process.pid}-${Date.now().toString(36)}`;
const PASSWORD = "cocina despensa nevera";
const NEW_PASSWORD = "nevera alacena despensa";

let householdId = "";

beforeAll(async () => {
  householdId = (await prisma.household.create({ data: { name: `Credentials ${RUN}` } })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  await prisma.household.deleteMany({ where: { id: householdId } });
  await prisma.$disconnect();
});

describe("an account made through the credentials module", () => {
  it("is found by its address with a hash its password verifies against", async () => {
    const email = `${RUN}.signin@example.com`;
    const created = await createCredentialUser(
      prisma,
      { email, name: "Cocina", householdId, role: "MEMBER" },
      await hashPassword(PASSWORD),
    );

    const credential = await findCredentialByEmail(prisma, email);

    expect(credential?.user).toEqual({
      id: created.id,
      email,
      name: "Cocina",
      householdId,
      role: "MEMBER",
    });
    expect(await verifyPassword(credential?.passwordHash, PASSWORD)).toBe(true);
    expect(await verifyPassword(credential?.passwordHash, NEW_PASSWORD)).toBe(false);
    expect(await readPasswordHash(prisma, created.id)).toBe(credential?.passwordHash ?? "");
  });

  it("answers null for an address with no account, and for an id with none", async () => {
    expect(await findCredentialByEmail(prisma, `${RUN}.nobody@example.com`)).toBeNull();
    expect(await readPasswordHash(prisma, `${RUN}-no-such-id`)).toBeNull();
  });
});

describe("setPasswordAndEndSessions", () => {
  it("writes nothing to an account whose role no longer matches the guard", async () => {
    const original = await hashPassword(PASSWORD);
    const member = await createCredentialUser(
      prisma,
      { email: `${RUN}.guarded@example.com`, name: "Miembro", householdId, role: "MEMBER" },
      original,
    );
    // Promoted after the caller checked it, while the new hash was being made.
    await prisma.user.update({ where: { id: member.id }, data: { role: "OWNER" } });

    const written = await setPasswordAndEndSessions(
      prisma,
      { userId: member.id, guard: { householdId, role: "MEMBER" } },
      await hashPassword(NEW_PASSWORD),
    );

    expect(written).toBe(0);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: member.id },
      select: { sessionsValidFrom: true },
    });
    expect(after.sessionsValidFrom).toBeNull();
    expect(await readPasswordHash(prisma, member.id)).toBe(original);
  });

  it("sets the hash and ends the sessions in one write when the guard holds", async () => {
    const member = await createCredentialUser(
      prisma,
      { email: `${RUN}.reset@example.com`, name: "Miembro", householdId, role: "MEMBER" },
      await hashPassword(PASSWORD),
    );
    const before = Date.now();

    const written = await setPasswordAndEndSessions(
      prisma,
      { userId: member.id, guard: { householdId, role: "MEMBER" } },
      await hashPassword(NEW_PASSWORD),
    );

    expect(written).toBe(1);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: member.id },
      select: { sessionsValidFrom: true },
    });
    expect(after.sessionsValidFrom?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const credential = await findCredentialByEmail(prisma, `${RUN}.reset@example.com`);
    expect(await verifyPassword(credential?.passwordHash, NEW_PASSWORD)).toBe(true);
  });
});
