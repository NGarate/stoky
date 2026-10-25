import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { prisma } from "@/lib/prisma";

/**
 * The `Session` table's one rule that is the database's rather than Better
 * Auth's: a deleted account takes its sessions with it (ASVS 7.4.2). Better
 * Auth's adapter never deletes a user's sessions itself, so without the
 * cascade an account removed from the household would leave rows behind whose
 * tokens still name it — the exception to the schema's no-cascades rule that
 * `Account` already makes (PROGRESS D134).
 *
 * The same holds for an authenticator secret (`TwoFactor`, PROGRESS D148) and
 * a passkey (`Passkey`, D151): credentials, which go with their account.
 *
 * Rows are written directly: what is under test is the foreign key, not who
 * writes the rows.
 */

const RUN = `authtables-${process.pid}-${Date.now().toString(36)}`;
const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);

let leaving = "";
let staying = "";

beforeAll(async () => {
  leaving = (
    await prisma.user.create({
      data: { email: `${RUN}.leaving@example.com`, name: "Se va" },
    })
  ).id;
  staying = (
    await prisma.user.create({
      data: { email: `${RUN}.staying@example.com`, name: "Se queda" },
    })
  ).id;
  await prisma.session.createMany({
    data: [
      { token: `${RUN}-leaving-phone`, userId: leaving, expiresAt: inAnHour() },
      {
        token: `${RUN}-leaving-laptop`,
        userId: leaving,
        expiresAt: inAnHour(),
      },
      { token: `${RUN}-staying-phone`, userId: staying, expiresAt: inAnHour() },
    ],
  });
  await prisma.passkey.createMany({
    data: [
      {
        userId: leaving,
        credentialID: `${RUN}-leaving-key`,
        publicKey: "pk",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      },
      {
        userId: staying,
        credentialID: `${RUN}-staying-key`,
        publicKey: "pk",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      },
    ],
  });
  await prisma.twoFactor.createMany({
    data: [
      { userId: leaving, secret: `${RUN}-leaving-secret`, backupCodes: "[]" },
      { userId: staying, secret: `${RUN}-staying-secret`, backupCodes: "[]" },
    ],
  });
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { token: { startsWith: RUN } } });
  await prisma.twoFactor.deleteMany({ where: { secret: { startsWith: RUN } } });
  await prisma.passkey.deleteMany({
    where: { credentialID: { startsWith: RUN } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  await prisma.$disconnect();
});

describe("an account's sessions", () => {
  it("go with the account when it is deleted, and nobody else's do", async () => {
    await prisma.user.delete({ where: { id: leaving } });

    expect(await prisma.session.count({ where: { userId: leaving } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: staying } })).toBe(1);
  });
});

describe("an account's authenticator", () => {
  it("goes with the account when it is deleted, and nobody else's does", async () => {
    // The account was deleted by the test above; the order is the file's.
    expect(await prisma.user.count({ where: { id: leaving } })).toBe(0);

    expect(await prisma.twoFactor.count({ where: { userId: leaving } })).toBe(
      0,
    );
    expect(await prisma.twoFactor.count({ where: { userId: staying } })).toBe(
      1,
    );
  });
});

describe("an account's passkeys", () => {
  it("go with the account when it is deleted, and nobody else's do", async () => {
    expect(await prisma.user.count({ where: { id: leaving } })).toBe(0);

    expect(await prisma.passkey.count({ where: { userId: leaving } })).toBe(0);
    expect(await prisma.passkey.count({ where: { userId: staying } })).toBe(1);
  });
});
