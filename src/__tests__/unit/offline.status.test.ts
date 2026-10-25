import { describe, it, expect } from "bun:test";
import { isUrgent, syncStatus, type SyncState } from "@/lib/offline/status";
import type { FailedOp, QueuedOp, QueueState } from "@/lib/offline/queue";

/**
 * What the shell says about the queue, enumerated rather than sampled.
 *
 * The property that matters is not which word appears for a given queue — it is
 * that **no queue produces no word**. Someone standing in a supermarket looking
 * at this screen must not find a hole in it, and a hand-picked dozen cases is
 * exactly how a hole survives.
 *
 * So the whole cross-product is generated below.
 */

function op(id: string): QueuedOp {
  return {
    id,
    path: "shopping.updateItem",
    input: { id: "item-1", isChecked: true },
    householdId: "h1",
    label: { key: "offline.tickedOff" },
    createdAt: new Date("2026-08-11T10:00:00.000Z"),
    attempts: 0,
  };
}

function failed(id: string, reason: FailedOp["reason"]): FailedOp {
  return { ...op(id), reason };
}

const REASONS: FailedOp["reason"][] = [
  "needs-reconciliation",
  "needs-review",
  "wrong-household",
  "refused",
  "gone",
  "invalid",
  "exhausted",
];

const STATUSES: QueueState["status"][] = ["idle", "sending", "needs-signin"];

describe("syncStatus over every queue it can be handed", () => {
  it("gives every one of them a named state", () => {
    const unnamed: string[] = [];

    for (const status of STATUSES) {
      for (const full of [false, true]) {
        for (const pendingCount of [0, 1, 3]) {
          for (const reason of [null, ...REASONS]) {
            const state: QueueState = {
              status,
              full,
              hydrated: true,
              pending: Array.from({ length: pendingCount }, (_, i) =>
                op(`p${i}`),
              ),
              failed: reason ? [failed("f1", reason)] : [],
            };

            const summary = syncStatus(state);
            if (summary.state === "unrepresented") {
              unnamed.push(
                `${status}/full=${full}/pending=${pendingCount}/${reason}`,
              );
            }
          }
        }
      }
    }

    // 126 points. A hole here is a blank space on a screen somebody is
    // relying on.
    expect(unnamed).toEqual([]);
  });

  it("never calls a queue with a terminal failure 'synced'", () => {
    for (const reason of REASONS) {
      const state: QueueState = {
        status: "idle",
        full: false,
        hydrated: true,
        pending: [],
        failed: [failed("f1", reason)],
      };

      expect(syncStatus(state).state).not.toBe("synced");
    }
  });

  it("does not throw on a shape it was never meant to see", () => {
    // A throw in render is a white screen, and this runs on every render of
    // the shell. `unrepresented` is the honest floor.
    const nonsense = { status: "idle" } as unknown as QueueState;

    expect(() => syncStatus(nonsense)).not.toThrow();
  });
});

describe("what it says, and in which order", () => {
  const base: QueueState = {
    status: "idle",
    full: false,
    hydrated: true,
    pending: [],
    failed: [],
  };

  it("is synced when there is nothing at all", () => {
    expect(syncStatus(base)).toEqual({ state: "synced", count: 0 });
  });

  it("counts what is waiting", () => {
    expect(syncStatus({ ...base, pending: [op("a"), op("b")] })).toEqual({
      state: "pending",
      count: 2,
    });
  });

  it("says it is sending while it is", () => {
    expect(
      syncStatus({ ...base, status: "sending", pending: [op("a")] }).state,
    ).toBe("syncing");
  });

  it("puts a session that ended before everything else", () => {
    // It blocks every other outcome, so it is said first even when other
    // things are also true.
    const state: QueueState = {
      status: "needs-signin",
      full: true,
      hydrated: true,
      pending: [op("a")],
      failed: [failed("f1", "needs-reconciliation")],
    };

    expect(syncStatus(state).state).toBe("needs-signin");
  });

  it("puts a stock disagreement ahead of an ordinary failure", () => {
    const state: QueueState = {
      ...base,
      failed: [failed("f1", "refused"), failed("f2", "needs-reconciliation")],
    };

    // One needs a person to look at a shelf; the other needs a tap. The one
    // that needs thinking is named first.
    expect(syncStatus(state)).toEqual({
      state: "needs-reconciliation",
      count: 1,
    });
  });

  it("counts only the failures it is talking about", () => {
    const state: QueueState = {
      ...base,
      failed: [failed("f1", "refused"), failed("f2", "exhausted")],
    };

    expect(syncStatus(state)).toEqual({ state: "failed", count: 2 });
  });

  it("names a scan waiting for review, and counts only those", () => {
    const state: QueueState = {
      ...base,
      failed: [failed("f1", "needs-review"), failed("f2", "refused")],
    };

    // Ahead of an ordinary failure, behind a stock disagreement — a scan to
    // name is a question, like reconcile, and both come before "it failed".
    expect(syncStatus(state)).toEqual({ state: "needs-review", count: 1 });
  });

  it("puts a stock disagreement ahead of a scan to review", () => {
    const state: QueueState = {
      ...base,
      failed: [
        failed("f1", "needs-review"),
        failed("f2", "needs-reconciliation"),
      ],
    };

    expect(syncStatus(state).state).toBe("needs-reconciliation");
  });
});

describe("which live region a state belongs in", () => {
  const urgent: SyncState[] = [
    "needs-signin",
    "needs-reconciliation",
    "needs-review",
    "failed",
    "full",
    "unrepresented",
  ];
  const calm: SyncState[] = ["synced", "pending", "syncing"];

  it("puts the ones needing a person in the alert region", () => {
    for (const state of urgent) expect(isUrgent(state)).toBe(true);
  });

  it("leaves the calm ones in the status region", () => {
    for (const state of calm) expect(isUrgent(state)).toBe(false);
  });

  it("covers every state, so none can fall between the two", () => {
    expect([...urgent, ...calm].sort() as string[]).toEqual(
      [
        "failed",
        "full",
        "needs-reconciliation",
        "needs-review",
        "needs-signin",
        "pending",
        "synced",
        "syncing",
        "unrepresented",
      ].sort(),
    );
  });
});
