import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { SessionDb } from "@/lib/auth/end-sessions";
import { MAX_SESSIONS_PER_ACCOUNT } from "@/lib/auth/session-policy";
import {
  capSessions,
  signInTidyFilter,
  tidyAfterSignIn,
  type TidyDb,
} from "@/lib/auth/sign-in-tidy";

/**
 * The filter a sign-in's tidy deletes by, and the one shape it must never
 * take: `{ id: undefined }` inside the `OR`, which Prisma turns into an empty
 * clause whose meaning is the client's to decide (D139) — and which
 * `endSessions`, checking only the top level, would not catch. Asserted on the
 * filter itself because the database cannot tell it apart today: Prisma 6.19
 * reads the empty clause as matching nothing. That the rows really go is
 * `integration/session.sign-in-tidy.test.ts`, and the cap's
 * `integration/session.cap.test.ts`.
 */

const NOW = new Date("2026-10-15T12:00:00Z");

/**
 * A client that records the order of what the tidy asks of it. `count` is
 * what each delete reports; `beyond` is the ids the cap's query finds. The
 * rows `endSessions` reads before it deletes are none, so it has no step-ups
 * to end (that is `end-sessions.test.ts`).
 */
function fakeDb(count = 1, beyond: string[] = []) {
  const calls: string[] = [];
  const deleteMany = mock(async (_args: unknown) => {
    calls.push("deleteMany");
    return { count };
  });
  const findMany = mock(async (args: { select?: { userId?: boolean } }) => {
    // `endSessions` reads the rows it is about to end, for their step-ups
    // (D151); the cap's own query selects ids alone.
    if (args.select?.userId) {
      calls.push("findMany ending");
      return [];
    }
    calls.push("findMany");
    return beyond.map((id) => ({ id }));
  });
  const queryRaw = mock(async (strings: TemplateStringsArray, ..._values: unknown[]) => {
    calls.push(`queryRaw ${strings.join("?")}`);
    return [];
  });
  const tx = { session: { deleteMany, findMany }, $queryRaw: queryRaw };
  const transaction = mock(async (run: (client: typeof tx) => Promise<unknown>) => {
    calls.push("begin");
    const result = await run(tx);
    calls.push("commit");
    return result;
  });
  return {
    db: { $transaction: transaction } as unknown as TidyDb,
    tx: tx as unknown as SessionDb,
    calls,
    deleteMany,
    findMany,
    queryRaw,
    transaction,
  };
}

const ended = () =>
  warn.mock.calls
    .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
    .filter((line) => line.event === "auth.session.ended");

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

    const result = await tidyAfterSignIn(
      db,
      { previous: { id: "s-old", userId: "u-1" }, userId: "u-2", newToken: "t-new" },
      NOW,
    );

    expect(result).toEqual({ replaced: 2, evicted: 0 });
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

describe("capSessions", () => {
  it("asks for the account's other sessions past the nine the new one keeps, least recently used last", async () => {
    const { tx, findMany, deleteMany } = fakeDb(0, []);

    expect(await capSessions(tx, { userId: "u-1", keepToken: "t-new" })).toBe(0);

    expect(MAX_SESSIONS_PER_ACCOUNT).toBe(10);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "u-1", NOT: { token: "t-new" } },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: 9,
      select: { id: true },
    });
    // Nothing past the cap, so no delete at all.
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("ends what it found, still scoped to the account", async () => {
    const { tx, deleteMany } = fakeDb(2, ["s-a", "s-b"]);

    expect(await capSessions(tx, { userId: "u-1", keepToken: "t-new" })).toBe(2);

    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "u-1", id: { in: ["s-a", "s-b"] } } });
  });

  it("refuses to count without the account or the token it keeps", async () => {
    const { tx, findMany } = fakeDb();

    await expect(capSessions(tx, { userId: "", keepToken: "t" })).rejects.toThrow();
    await expect(capSessions(tx, { userId: "u", keepToken: "" })).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("tidyAfterSignIn and the cap", () => {
  it("locks the account, then tidies, then caps, in one transaction", async () => {
    const { db, calls, queryRaw } = fakeDb(1, []);

    await tidyAfterSignIn(db, { previous: null, userId: "u-1", newToken: "t-new" }, NOW);

    expect(calls).toEqual([
      "begin",
      'queryRaw SELECT id FROM "User" WHERE id = ? FOR UPDATE',
      "findMany ending",
      "deleteMany",
      "findMany",
      "commit",
    ]);
    // The id is a bound value, not part of the statement.
    expect(queryRaw.mock.calls[0].slice(1)).toEqual(["u-1"]);
  });

  it("records an eviction on a line of its own, with no token on it", async () => {
    const { db } = fakeDb(1, ["s-lru"]);

    const result = await tidyAfterSignIn(
      db,
      { previous: { id: "s-old", userId: "u-1" }, userId: "u-1", newToken: "t-new" },
      NOW,
    );

    expect(result).toEqual({ replaced: 1, evicted: 1 });
    expect(ended()).toEqual([
      expect.objectContaining({ reason: "replaced", userId: "u-1", targetUserId: "u-1", count: "1" }),
      expect.objectContaining({ reason: "evicted", userId: "u-1", targetUserId: "u-1", count: "1" }),
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("t-new");
  });

  it("writes nothing when the transaction fails", async () => {
    const { db, findMany } = fakeDb(1, ["s-lru"]);
    findMany.mockImplementation(async () => {
      throw new Error("serialisation failure");
    });

    await expect(
      tidyAfterSignIn(db, { previous: { id: "s-old", userId: "u-1" }, userId: "u-1", newToken: "t-new" }, NOW),
    ).rejects.toThrow("serialisation failure");
    expect(ended()).toEqual([]);
  });

  it("opens no transaction for a sign-in without an account or a token", async () => {
    const { db, transaction } = fakeDb();

    await expect(tidyAfterSignIn(db, { previous: null, userId: "", newToken: "t" }, NOW)).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});
