import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { SessionDb } from "@/lib/auth/end-sessions";
import { signInTidyFilter, tidyAfterSignIn } from "@/lib/auth/sign-in-tidy";

/**
 * The filter a sign-in's tidy deletes by, and the one shape it must never
 * take: `{ id: undefined }` inside the `OR`, which Prisma turns into an empty
 * clause whose meaning is the client's to decide (D139) — and which
 * `endSessions`, checking only the top level, would not catch. Asserted on the
 * filter itself because the database cannot tell it apart today: Prisma 6.19
 * reads the empty clause as matching nothing. That the rows really go is
 * `integration/session.sign-in-tidy.test.ts`.
 */

const NOW = new Date("2026-10-15T12:00:00Z");

function fakeDb(count = 1) {
  const deleteMany = mock(async (_args: unknown) => ({ count }));
  return { db: { session: { deleteMany } } as unknown as SessionDb, deleteMany };
}

let warn: ReturnType<typeof spyOn<Console, "warn">>;
beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("signInTidyFilter", () => {
  it("names the presented session and the account's expired rows, never the new one", () => {
    expect(
      signInTidyFilter(
        { previous: { id: "s-old", userId: "u-1" }, userId: "u-2", newToken: "t-new" },
        NOW,
      ),
    ).toEqual({
      OR: [{ id: "s-old" }, { userId: "u-2", expiresAt: { lt: NOW } }],
      NOT: { token: "t-new" },
    });
  });

  it("leaves the id clause out when nothing was presented", () => {
    const filter = signInTidyFilter({ previous: null, userId: "u-1", newToken: "t-new" }, NOW);

    expect(filter.OR).toEqual([{ userId: "u-1", expiresAt: { lt: NOW } }]);
    // Not even as `{ id: undefined }`, an empty clause by another name.
    expect(JSON.stringify(filter)).not.toContain('"id"');
    expect(filter.OR as unknown[]).not.toContainEqual({ id: undefined });
  });

  it("refuses to build a filter without the account or the new token", () => {
    expect(() => signInTidyFilter({ previous: null, userId: "", newToken: "t" }, NOW)).toThrow();
    expect(() => signInTidyFilter({ previous: null, userId: "u", newToken: "" }, NOW)).toThrow();
  });
});

describe("tidyAfterSignIn", () => {
  it("deletes by the filter, says how many and records what it replaced", async () => {
    const { db, deleteMany } = fakeDb(2);

    const count = await tidyAfterSignIn(
      db,
      { previous: { id: "s-old", userId: "u-1" }, userId: "u-2", newToken: "t-new" },
      NOW,
    );

    expect(count).toBe(2);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(line).toMatchObject({
      event: "auth.session.ended",
      reason: "replaced",
      userId: "u-2",
      targetUserId: "u-1",
      count: "2",
    });
    expect(JSON.stringify(line)).not.toContain("t-new");
  });

  it("records nothing when no session was presented", async () => {
    const { db } = fakeDb(3);

    await tidyAfterSignIn(db, { previous: null, userId: "u-1", newToken: "t-new" }, NOW);

    expect(warn).not.toHaveBeenCalled();
  });
});
