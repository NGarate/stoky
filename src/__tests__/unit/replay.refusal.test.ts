import { describe, expect, it } from "bun:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { withReplay, type ReplayContext } from "@/server/trpc/replay";

/**
 * A replay refused while the housekeeping sweep is still running.
 *
 * `withReplay` answered a reused key with `return answerFromRecord(...)` from
 * a `catch` whose `finally` then awaits `sweepExpired`. The returned promise is
 * only adopted once `finally` completes, so when the refusal settled first it
 * sat rejected with no handler for as long as the sweep took — an unhandled
 * rejection, which Bun reports against whatever is running. That was ISSUES
 * TEST-8: `resolveScan`'s "refuses the same key carrying a different barcode"
 * failing about one full run in four, with the expected BAD_REQUEST raised
 * from nowhere. The caller still received the refusal; the process had
 * already been told nobody would.
 *
 * The sweep is made slow here so the race goes the bad way every time. Bun
 * fails the running test on an unhandled rejection by itself, so no listener
 * is needed: before the fix this test fails 3 runs in 3, with the same
 * BAD_REQUEST and the same trace CI showed.
 */

function contextWithClaimedKey(): ReplayContext {
  const claimed = new Prisma.PrismaClientKnownRequestError("duplicate key", {
    code: "P2002",
    clientVersion: "test",
  });
  const db = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        mutationReplay: {
          create: async () => {
            throw claimed;
          },
        },
      }),
    mutationReplay: {
      // The key is on record for a different body: the refusal is immediate.
      findUnique: async () => ({
        procedure: "product.resolveScan",
        requestHash: "a different request",
        householdId: "household",
        resultIds: [],
      }),
      deleteMany: () => new Promise((resolve) => setTimeout(resolve, 25)),
    },
  };
  return {
    db: db as unknown as PrismaClient,
    session: { user: { id: "user" } },
    householdId: "household",
  };
}

describe("a key reused with a different body", () => {
  it("is refused to the caller, and never as an unhandled rejection", async () => {
    const outcome = withReplay(contextWithClaimedKey(), {
      key: "key",
      composedByUserId: "user",
      procedure: "product.resolveScan",
      input: { barcode: "8410000444444" },
      apply: async () => ({}),
      ids: () => [],
      reread: async () => ({}),
    });

    await expect(outcome).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
