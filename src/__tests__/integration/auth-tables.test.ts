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
 * Rows are written directly: nothing in the application creates a session
 * yet, and what is under test is the foreign key, not who writes the rows.
 */

const RUN = `authtables-${process.pid}-${Date.now().toString(36)}`;
const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);

let leaving = "";
let staying = "";

beforeAll(async () => {
  leaving = (await prisma.user.create({ data: { email: `${RUN}.leaving@example.com`, name: "Se va" } })).id;
  staying = (await prisma.user.create({ data: { email: `${RUN}.staying@example.com`, name: "Se queda" } })).id;
  await prisma.session.createMany({
    data: [
      { token: `${RUN}-leaving-phone`, userId: leaving, expiresAt: inAnHour() },
      { token: `${RUN}-leaving-laptop`, userId: leaving, expiresAt: inAnHour() },
      { token: `${RUN}-staying-phone`, userId: staying, expiresAt: inAnHour() },
    ],
  });
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { token: { startsWith: RUN } } });
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
