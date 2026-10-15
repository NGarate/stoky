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

/**
 * A client whose sessions belong to `owners`, whose household-wide `user`
 * filter finds `members`, and whose `Verification` table holds `challenges`
 * (identifier → value).
 */
function fakeDb(
  count = 2,
  {
    owners = [] as string[],
    members = [] as string[],
    challenges = {} as Record<string, string>,
  } = {},
) {
  const deleteMany = mock(async (_args: unknown) => ({ count }));
  const sessionFindMany = mock(async (_args: unknown) => owners.map((userId) => ({ userId })));
  const userFindMany = mock(async (_args: unknown) => members.map((id) => ({ id })));
  const verificationFindMany = mock(async (args: { where: { value: { in: string[] } } }) =>
    Object.entries(challenges)
      .filter(([, value]) => args.where.value.in.includes(value))
      .map(([identifier]) => ({ identifier })),
  );
  const verificationDeleteMany = mock(async (_args: unknown) => ({ count: 0 }));
  const db = {
    session: { deleteMany, findMany: sessionFindMany },
    user: { findMany: userFindMany },
    verification: { findMany: verificationFindMany, deleteMany: verificationDeleteMany },
  } as unknown as SessionDb;
  return { db, deleteMany, userFindMany, verificationFindMany, verificationDeleteMany };
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

  describe("with the two-step sign-ins in progress (D148)", () => {
    const deleted = (call: unknown) =>
      (call as { where: { identifier: { in: string[] } } }).where.identifier.in.sort();

    it("deletes the challenges of the account it names, and their attempt counters", async () => {
      const { db, verificationFindMany, verificationDeleteMany } = fakeDb(0, {
        members: ["user-1"],
        challenges: { "2fa-abc": "user-1", "2fa-other": "user-2" },
      });

      // No session left at all: the password step's was deleted by Better
      // Auth, and the challenge is all the sign-in has.
      await endSessions(db, { userId: "user-1" });

      expect(verificationFindMany).toHaveBeenCalledWith({
        where: { identifier: { startsWith: "2fa-" }, value: { in: ["user-1"] } },
        select: { identifier: true },
      });
      expect(deleted(verificationDeleteMany.mock.calls[0][0])).toEqual([
        "2fa-abc",
        "2fa-attempts-2fa-abc",
      ]);
    });

    it("finds the accounts behind a filter that names none by id", async () => {
      // "End every session in the household": the owner's filter is a
      // relation, and members with no session left still have challenges.
      const { db, userFindMany, verificationFindMany } = fakeDb(1, {
        owners: ["user-1"],
        members: ["user-1", "user-2"],
        challenges: { "2fa-b": "user-2" },
      });

      await endSessions(db, { user: { householdId: "h-1" } });

      expect(userFindMany).toHaveBeenCalledWith({
        where: { householdId: "h-1" },
        select: { id: true },
      });
      expect(verificationFindMany.mock.calls[0][0].where.value.in.sort()).toEqual([
        "user-1",
        "user-2",
      ]);
    });

    it("keeps an admin's guard on the account when it looks for whose they are", async () => {
      const { db, userFindMany } = fakeDb(1);

      await endSessions(db, { userId: "user-1", user: { householdId: "h-1", role: "MEMBER" } });

      expect(userFindMany).toHaveBeenCalledWith({
        where: { id: "user-1", householdId: "h-1", role: "MEMBER" },
        select: { id: true },
      });
    });

    it("leaves them alone when asked to, for the sign-in's own housekeeping", async () => {
      const { db, verificationFindMany, verificationDeleteMany } = fakeDb(1, {
        members: ["user-1"],
        challenges: { "2fa-abc": "user-1" },
      });

      await endSessions(db, { userId: "user-1" }, { challenges: false });

      expect(verificationFindMany).not.toHaveBeenCalled();
      expect(verificationDeleteMany).not.toHaveBeenCalled();
    });

    it("deletes nothing else when there is nothing to delete", async () => {
      const { db, verificationDeleteMany } = fakeDb(1, {
        members: ["user-1"],
        challenges: { "2fa-x": "user-9" },
      });

      await endSessions(db, { userId: "user-1" });

      expect(verificationDeleteMany).not.toHaveBeenCalled();
    });
  });
});
