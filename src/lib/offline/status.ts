import type { QueueState } from "./queue";

/**
 * What the interface says about the queue, as one word.
 *
 * A pure function so the whole cross-product of queue states can be enumerated
 * in a test rather than sampled by hand — and so the one property that matters
 * can be asserted: **every point maps to a named state**. A screen that a
 * person is standing in a supermarket looking at must not have a hole in it.
 *
 * It **never throws**. A throw in render is a white screen, and this runs on
 * every render of the shell. An input it does not recognise becomes
 * `unrepresented`, which is rendered as the most alarming honest copy rather
 * than as nothing — and the test below is what stops that state being
 * reachable.
 */
export type SyncState =
  | "synced"
  | "pending"
  | "syncing"
  | "needs-signin"
  | "needs-reconciliation"
  | "failed"
  | "full"
  | "unrepresented";

export interface SyncSummary {
  state: SyncState;
  /** How many changes the state is about. */
  count: number;
}

export function syncStatus(queue: QueueState): SyncSummary {
  try {
    const pending = queue.pending?.length ?? 0;
    const failed = queue.failed ?? [];
    const toReconcile = failed.filter(
      (op) => op.reason === "needs-reconciliation",
    );
    const otherFailures = failed.length - toReconcile.length;

    // Ordered by what someone has to do about it, hardest first. A session that
    // ended blocks everything else, so it is said first even when other things
    // are also true.
    if (queue.status === "needs-signin") {
      return { state: "needs-signin", count: pending };
    }
    if (toReconcile.length > 0) {
      return { state: "needs-reconciliation", count: toReconcile.length };
    }
    if (otherFailures > 0) {
      return { state: "failed", count: otherFailures };
    }
    if (queue.full) {
      return { state: "full", count: pending };
    }
    if (queue.status === "sending") {
      return { state: "syncing", count: pending };
    }
    if (pending > 0) {
      return { state: "pending", count: pending };
    }
    return { state: "synced", count: 0 };
  } catch {
    return { state: "unrepresented", count: 0 };
  }
}

/**
 * Which live region a state belongs in.
 *
 * Two permanent sibling regions, and each state lives in the one that owns it.
 * **Not one node whose role changes**: swapping a live region's role mid-life
 * is unreliable across screen readers, and a rendered test would happily pass
 * it.
 */
export function isUrgent(state: SyncState): boolean {
  return (
    state === "needs-signin" ||
    state === "needs-reconciliation" ||
    state === "failed" ||
    state === "full" ||
    state === "unrepresented"
  );
}
