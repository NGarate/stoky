import { describe, it, expect, spyOn } from "bun:test";
import type { PrismaClient } from "@/generated/prisma/client";
import * as recovery from "@/server/services/receipt-recovery";

/**
 * The start-up sweep for receipts a restart left half-read. What it changes
 * in the database is `integration/ocr.pipeline.test.ts` ("Restart
 * recovery"); this is the part that needs no database: that it runs when the
 * server starts, with the right cutoff, and that it cannot stop the start.
 */

type Db = Pick<PrismaClient, "receipt">;

/** A stand-in for Prisma whose `updateMany` does what `respond` says. */
function dbThat(respond: () => Promise<{ count: number }>): Db {
  return { receipt: { updateMany: respond } } as unknown as Db;
}

describe("recoverInterruptedReceipts", () => {
  it("logs a database that cannot be reached and resolves", async () => {
    // At start the database may not be up yet. That is a reason to log, not
    // an unhandled rejection in the process that is meant to be serving.
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        recovery.recoverInterruptedReceipts(
          new Date(),
          dbThat(() => Promise.reject(new Error("connection refused"))),
        ),
      ).resolves.toBeUndefined();
      // Filtered for the same reason as the warning below.
      const ours = logged.mock.calls.filter(([message]) =>
        String(message).startsWith("Could not fail receipts"),
      );
      expect(ours).toHaveLength(1);
      expect(String(ours[0]?.[1])).toContain("connection refused");
    } finally {
      logged.mockRestore();
    }
  });

  it("says how many it failed, and why, because no column will", async () => {
    const warned = spyOn(console, "warn").mockImplementation(() => {});
    // Filtered: in the full unit run, an auth test's security-log line
    // (`auth.signin.failed`) lands in this spy too — measured.
    const ours = () =>
      warned.mock.calls
        .map(([message]) => String(message))
        .filter((m) => /interrupted/.test(m));
    try {
      await recovery.recoverInterruptedReceipts(
        new Date(),
        dbThat(() => Promise.resolve({ count: 2 })),
      );
      expect(ours()).toEqual([
        expect.stringMatching(/^Marked 2 receipt\(s\) FAILED/),
      ]);

      warned.mockClear();
      await recovery.recoverInterruptedReceipts(
        new Date(),
        dbThat(() => Promise.resolve({ count: 0 })),
      );
      expect(ours()).toEqual([]);
    } finally {
      warned.mockRestore();
    }
  });
});

describe("at server start", () => {
  /** `process.env` without the read-only `NODE_ENV` of the Next typings. */
  const env = process.env as Record<string, string | undefined>;

  it("runs from the instrumentation hook, cut off at the moment the server started", async () => {
    // Replaced, so the suite never sweeps whatever database `.env` names.
    const sweep = spyOn(
      recovery,
      "recoverInterruptedReceipts",
    ).mockResolvedValue();
    const runtime = env.NEXT_RUNTIME;
    env.NEXT_RUNTIME = "nodejs";
    try {
      const { register } = await import("@/instrumentation");
      const before = Date.now();
      await register();
      const after = Date.now();

      expect(sweep).toHaveBeenCalledTimes(1);
      const cutoff = sweep.mock.calls[0]?.[0];
      expect(cutoff).toBeInstanceOf(Date);
      // Not earlier than the start (it would leave a stranded receipt from
      // just before it) and not later than `register` returning, after which
      // this process takes receipts of its own.
      expect(cutoff!.getTime()).toBeGreaterThanOrEqual(before);
      expect(cutoff!.getTime()).toBeLessThanOrEqual(after);
    } finally {
      if (runtime === undefined) delete env.NEXT_RUNTIME;
      else env.NEXT_RUNTIME = runtime;
      sweep.mockRestore();
    }
  });

  it("does not run outside the Node runtime", async () => {
    const sweep = spyOn(
      recovery,
      "recoverInterruptedReceipts",
    ).mockResolvedValue();
    const runtime = env.NEXT_RUNTIME;
    env.NEXT_RUNTIME = "edge";
    try {
      const { register } = await import("@/instrumentation");
      await register();
      expect(sweep).not.toHaveBeenCalled();
    } finally {
      if (runtime === undefined) delete env.NEXT_RUNTIME;
      else env.NEXT_RUNTIME = runtime;
      sweep.mockRestore();
    }
  });
});
