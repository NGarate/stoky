import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as argon2 from "argon2";
import type { Session } from "next-auth";
import { createTRPCRouter, createTRPCContext, writeProcedure } from "@/server/trpc/trpc";
import { withReplay } from "@/server/trpc/replay";
import { replayable } from "@/lib/validations/idempotency";
import { prisma } from "@/lib/prisma";

/**
 * `withReplay`, against a real PostgreSQL, on a procedure that exists only here.
 *
 * The mechanism is tested apart from the five procedures that will use it, so a
 * failure names the mechanism rather than a resolver. The throwaway procedure
 * writes a `StorageLocation` — a household-scoped row with a name, which is
 * enough to tell "applied once" from "applied twice" and enough to prove the
 * table stores no household data.
 *
 * Every interesting property here needs a real database: a unique constraint
 * arbitrating a race, a transaction rolling back, and a claim released by that
 * rollback. None of it is expressible against a mock.
 */

const A = { userId: "", householdId: "" };
const B = { userId: "", householdId: "" };

/** The name every applied call writes, so counting rows counts applications. */
const WRITTEN_NAME = "Estante replay";

const throwawayInput = replayable.extend({
  name: z.string(),
  // Free text, so a test can check the replay table never keeps it.
  note: z.string().optional(),
});

const testRouter = createTRPCRouter({
  /** Creates one location, replay-protected. */
  makeLocation: writeProcedure
    .input(throwawayInput)
    .mutation(async ({ ctx, input }) =>
      withReplay(ctx, {
        key: input.idempotencyKey,
        composedByUserId: input.composedByUserId,
        procedure: "test.makeLocation",
        input,
        apply: (tx) =>
          tx.storageLocation.create({
            data: { name: input.name, householdId: ctx.householdId },
          }),
        ids: (location) => [location.id],
        reread: async (db, ids) => {
          const location = await db.storageLocation.findUnique({
            where: { id: ids[0] ?? "" },
          });
          if (!location) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Gone" });
          }
          return location;
        },
      }),
    ),

  /** Refuses before writing, to prove a resolver's own code survives. */
  alwaysRefuses: writeProcedure
    .input(replayable)
    .mutation(async ({ ctx, input }) =>
      withReplay(ctx, {
        key: input.idempotencyKey,
        composedByUserId: input.composedByUserId,
        procedure: "test.alwaysRefuses",
        input,
        apply: async () => {
          throw new TRPCError({ code: "CONFLICT", message: "Not enough" });
        },
        ids: () => [],
        reread: async () => {
          throw new Error("unreachable");
        },
      }),
    ),
});

async function caller(account: { userId: string; householdId: string }) {
  const session: Session = {
    user: {
      id: account.userId,
      email: `${account.userId}@example.com`,
      name: "Replay",
      householdId: account.householdId,
      role: "OWNER",
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  return testRouter.createCaller(await createTRPCContext({ session }));
}

/**
 * A fresh key per call, so nothing leaks between tests — or between runs.
 *
 * This was a counter formatted into a UUID, which produced the *same* sequence
 * on every run against a database the suite shares. `MutationReplay` is keyed
 * on `[userId, key]` and the users here are new each run, so it should have
 * been safe, and mostly was.
 *
 * It was not always. Two tests in this file failed on 2026-08-11 with their
 * *first* call rejected — a record for that (user, key) already existing under
 * a different procedure, which the `beforeEach` deletes. The mechanism was
 * never established: the lookup is scoped by user, the users are fresh, and the
 * failure would not reproduce for six runs and then did.
 *
 * So this removes the class rather than fixing a diagnosis. A random key cannot
 * collide with anything, and the determinism bought nothing — no test asserts a
 * key's value or its order.
 */
function freshKey(): string {
  return randomUUID();
}

async function expectCode(call: Promise<unknown>, code: TRPCError["code"]) {
  let thrown: unknown;
  try {
    await call;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TRPCError);
  expect((thrown as TRPCError).code).toBe(code);
}

function locationCount(householdId: string) {
  return prisma.storageLocation.count({
    where: { householdId, name: WRITTEN_NAME },
  });
}

async function makeHousehold(label: string) {
  const household = await prisma.household.create({
    data: { name: `Replay ${label}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `replay-${label}-${Date.now()}@example.com`,
      name: `Replay ${label}`,
      passwordHash: await argon2.hash("TestPassword123!", {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      }),
      householdId: household.id,
      role: "OWNER",
    },
  });
  return { userId: user.id, householdId: household.id };
}

beforeAll(async () => {
  Object.assign(A, await makeHousehold("A"));
  Object.assign(B, await makeHousehold("B"));
});

beforeEach(async () => {
  const households = [A.householdId, B.householdId];
  await prisma.storageLocation.deleteMany({
    where: { householdId: { in: households } },
  });
  await prisma.mutationReplay.deleteMany({
    where: { userId: { in: [A.userId, B.userId] } },
  });
});

afterAll(async () => {
  const households = [A.householdId, B.householdId];
  await prisma.storageLocation.deleteMany({
    where: { householdId: { in: households } },
  });
  await prisma.mutationReplay.deleteMany({
    where: { userId: { in: [A.userId, B.userId] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [A.userId, B.userId] } } });
  await prisma.household.deleteMany({ where: { id: { in: households } } });
  await prisma.$disconnect();
});

describe("a queued mutation arriving more than once", () => {
  it("applies once when the same key arrives twice", async () => {
    const api = await caller(A);
    const call = {
      idempotencyKey: freshKey(),
      composedByUserId: A.userId,
      name: WRITTEN_NAME,
    };

    const first = await api.makeLocation(call);
    const second = await api.makeLocation(call);

    expect(await locationCount(A.householdId)).toBe(1);
    expect(second.id).toBe(first.id);
  });

  it("produces one effect when two replays land at the same instant", async () => {
    const api = await caller(A);
    const call = {
      idempotencyKey: freshKey(),
      composedByUserId: A.userId,
      name: WRITTEN_NAME,
    };

    // The primary key is the arbiter. Drop it and this produces two rows.
    const [first, second] = await Promise.all([
      api.makeLocation(call),
      api.makeLocation(call),
    ]);

    expect(await locationCount(A.householdId)).toBe(1);
    expect(second.id).toBe(first.id);
  });

  /**
   * `retry: 2` on this test and its neighbour, and on no others — TEST-5.
   *
   * bun intermittently abandons a test body at an await whose promise rejects
   * out of a rolled-back Prisma transaction: the `catch` beside it never runs,
   * the test's own assertion never executes, and the *expected* refusal is
   * rendered as the failure. Diagnosed in ISSUES.md TEST-5 with a reproduction.
   * Upgrading is not the way out — 1.4.0 was measured against that reproduction
   * on 2026-08-25 and still fails it, which is why this retry is still here.
   *
   * The retry is safe precisely because the scope is two tests with one
   * diagnosed external cause: a real regression in `withReplay`'s refusal
   * logic fails deterministically and survives every retry — verified by
   * breaking the mismatch check and watching all three attempts go red. The
   * spurious failure is ~15% per run under load; three attempts leave ~0.3%.
   */
  it("refuses a key reused for a different change, and applies nothing", async () => {
    const api = await caller(A);
    const key = freshKey();

    await api.makeLocation({
      idempotencyKey: key,
      composedByUserId: A.userId,
      name: WRITTEN_NAME,
    });

    await expectCode(
      api.makeLocation({
        idempotencyKey: key,
        composedByUserId: A.userId,
        name: "Otro sitio",
      }),
      "BAD_REQUEST",
    );

    // Nothing runs and nothing is read out: answering with the first call's
    // result would make a guessed key a way to read someone's row.
    expect(await locationCount(A.householdId)).toBe(1);
    expect(
      await prisma.storageLocation.count({
        where: { householdId: A.householdId, name: "Otro sitio" },
      }),
    ).toBe(0);
   }, { retry: 2 });

  // See the retry note above — same defect, same scope, TEST-5.
  it("refuses a key reused for a different procedure", async () => {
    const api = await caller(A);
    const key = freshKey();

    await api.makeLocation({
      idempotencyKey: key,
      composedByUserId: A.userId,
      name: WRITTEN_NAME,
    });

    await expectCode(
      api.alwaysRefuses({ idempotencyKey: key, composedByUserId: A.userId }),
      "BAD_REQUEST",
    );
  }, { retry: 2 });
});

describe("a queued mutation the server refuses", () => {
  it("arrives as the resolver's own code, not as a server fault", async () => {
    const api = await caller(A);

    // If this became INTERNAL_SERVER_ERROR the queue would call it transient
    // and spend eight attempts on a refusal that will never change its mind.
    await expectCode(
      api.alwaysRefuses({
        idempotencyKey: freshKey(),
        composedByUserId: A.userId,
      }),
      "CONFLICT",
    );
  });

  it("records nothing, so the same key can be sent again", async () => {
    const api = await caller(A);
    const key = freshKey();

    await expectCode(
      api.alwaysRefuses({ idempotencyKey: key, composedByUserId: A.userId }),
      "CONFLICT",
    );

    expect(
      await prisma.mutationReplay.count({ where: { userId: A.userId, key } }),
    ).toBe(0);

    // The rollback released the claim, so the key is usable — which is what
    // makes a transient failure recoverable rather than a burned key.
    const location = await api.makeLocation({
      idempotencyKey: key,
      composedByUserId: A.userId,
      name: WRITTEN_NAME,
    });
    expect(location.name).toBe(WRITTEN_NAME);
  });
});

describe("a queue that outlived the account that filled it", () => {
  it("refuses a change composed by someone else, before claiming anything", async () => {
    const api = await caller(A);
    const key = freshKey();

    await expectCode(
      api.makeLocation({
        idempotencyKey: key,
        composedByUserId: B.userId,
        name: WRITTEN_NAME,
      }),
      "FORBIDDEN",
    );

    expect(await locationCount(A.householdId)).toBe(0);
    expect(await prisma.mutationReplay.count({ where: { key } })).toBe(0);
  });

  it("keeps one account's keys invisible to another", async () => {
    const apiA = await caller(A);
    const apiB = await caller(B);
    const key = freshKey();

    await apiA.makeLocation({
      idempotencyKey: key,
      composedByUserId: A.userId,
      name: WRITTEN_NAME,
    });

    // Same key, different account. It is a fresh claim in B's key space, so it
    // applies normally against B's household — key entropy is not a security
    // property here, the partition is.
    await apiB.makeLocation({
      idempotencyKey: key,
      composedByUserId: B.userId,
      name: WRITTEN_NAME,
    });

    expect(await locationCount(A.householdId)).toBe(1);
    expect(await locationCount(B.householdId)).toBe(1);
    expect(await prisma.mutationReplay.count({ where: { key } })).toBe(2);
  });
});

describe("what the replay table keeps", () => {
  it("stores ids and no household data", async () => {
    const api = await caller(A);
    const key = freshKey();

    await api.makeLocation({
      idempotencyKey: key,
      composedByUserId: A.userId,
      name: WRITTEN_NAME,
      note: "para la cena del viernes",
    });

    const record = await prisma.mutationReplay.findUnique({
      where: { userId_key: { userId: A.userId, key } },
    });

    expect(record).not.toBeNull();
    expect(JSON.stringify(record)).not.toContain("para la cena del viernes");
    expect(JSON.stringify(record)).not.toContain(WRITTEN_NAME);
    expect(record?.resultIds).toHaveLength(1);
  });

  it("answers a replay from the database, so a deleted row is honestly gone", async () => {
    const api = await caller(A);
    const call = {
      idempotencyKey: freshKey(),
      composedByUserId: A.userId,
      name: WRITTEN_NAME,
    };

    const created = await api.makeLocation(call);
    await prisma.storageLocation.delete({ where: { id: created.id } });

    // A stored copy of the result would hand back a row that no longer exists.
    await expectCode(api.makeLocation(call), "NOT_FOUND");
  });

  /**
   * OFFLINE-1. A device whose reply was lost resends the same key whenever it
   * is next opened — a month later is ordinary for a holiday or a tablet in a
   * drawer. Meanwhile any other replayable call from the account sweeps
   * whatever has expired. If the claim is gone by then, the resend claims
   * afresh and the change lands twice.
   *
   * The record is aged by moving its dates back rather than by mocking the
   * clock, so the retention applied at insert and the sweep's comparison both
   * run unmodified. Set the retention back to seven days and this goes red:
   * the sweep takes the claim and the resend writes a second row.
   */
  it("still recognises a change applied thirty days ago", async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const api = await caller(A);
    const call = {
      idempotencyKey: freshKey(),
      composedByUserId: A.userId,
      name: WRITTEN_NAME,
    };

    const first = await api.makeLocation(call);

    const record = await prisma.mutationReplay.findUniqueOrThrow({
      where: { userId_key: { userId: A.userId, key: call.idempotencyKey } },
    });
    await prisma.mutationReplay.update({
      where: { userId_key: { userId: A.userId, key: call.idempotencyKey } },
      data: {
        createdAt: new Date(record.createdAt.getTime() - 30 * DAY_MS),
        expiresAt: new Date(record.expiresAt.getTime() - 30 * DAY_MS),
      },
    });

    // Another device on the same account writes in the meantime, which is
    // what runs the sweep before the stale resend arrives.
    await api.makeLocation({
      idempotencyKey: freshKey(),
      composedByUserId: A.userId,
      name: "Otro dispositivo",
    });

    const resent = await api.makeLocation(call);

    expect(resent.id).toBe(first.id);
    expect(await locationCount(A.householdId)).toBe(1);
  });

  it("clears its own expired rows without a scheduler", async () => {
    const api = await caller(A);

    await prisma.mutationReplay.create({
      data: {
        key: freshKey(),
        userId: A.userId,
        householdId: A.householdId,
        procedure: "test.makeLocation",
        requestHash: "stale",
        resultIds: [],
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await api.makeLocation({
      idempotencyKey: freshKey(),
      composedByUserId: A.userId,
      name: WRITTEN_NAME,
    });

    const remaining = await prisma.mutationReplay.findMany({
      where: { userId: A.userId },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.requestHash).not.toBe("stale");
  });
});
