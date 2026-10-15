import { describe, expect, it, mock } from "bun:test";
import { endSessions, type SessionDb } from "@/lib/auth/end-sessions";

/**
 * The one way sessions end, and the one filter it will not run.
 *
 * Prisma reads `{ userId: undefined }` as no condition at all, so a caller
 * that lost its id on the way would delete every session on the instance —
 * everybody signed out by one admin's click. That is refused here, before the
 * database is asked anything. That the rows really go, and the cookie with
 * them, is `integration/session.revocation.test.ts`.
 */

function fakeDb(count = 2) {
  const deleteMany = mock(async (_args: unknown) => ({ count }));
  return { db: { session: { deleteMany } } as unknown as SessionDb, deleteMany };
}

describe("endSessions", () => {
  it("deletes what the filter names and says how many", async () => {
    const { db, deleteMany } = fakeDb(3);

    expect(await endSessions(db, { userId: "user-1" })).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("refuses a filter whose value went missing, and deletes nothing", async () => {
    const { db, deleteMany } = fakeDb();

    await expect(endSessions(db, { userId: undefined })).rejects.toThrow(/every session/);
    await expect(endSessions(db, { userId: "user-1", id: undefined })).rejects.toThrow();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("refuses a missing value one level down, which would also be everyone", async () => {
    // "Every session but this one" from a context with no "this one": Prisma
    // reads `{ not: undefined }` as no condition, so it would end them all.
    const { db, deleteMany } = fakeDb();

    await expect(
      endSessions(db, { userId: "user-1", id: { not: undefined } }),
    ).rejects.toThrow(/every session/);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("still runs a filter whose nested values are all there", async () => {
    const { db, deleteMany } = fakeDb(1);
    const now = new Date();

    expect(
      await endSessions(db, { userId: "user-1", id: { not: "s-1" }, expiresAt: { lt: now } }),
    ).toBe(1);
    expect(await endSessions(db, { userId: "user-1", id: { in: ["s-2", "s-3"] } })).toBe(1);
    expect(deleteMany).toHaveBeenCalledTimes(2);
  });

  it("refuses an empty filter, which would be everyone", async () => {
    const { db, deleteMany } = fakeDb();

    await expect(endSessions(db, {})).rejects.toThrow(/every session/);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
