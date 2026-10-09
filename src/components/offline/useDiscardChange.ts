"use client";

import { useTranslations } from "next-intl";
import { useSnackbar } from "@/components/ui/snackbar";
import { useWriteQueue } from "@/lib/offline/queue-context";
import { undoHoldMs } from "@/lib/snackbar-duration";
import type { FailedOp } from "@/lib/offline/queue";

/**
 * Discard an unsaved change, and offer to take that back.
 *
 * "Descartar" deleted a change somebody made — the milk they used, the item
 * they ticked — in one tap, and nothing put it back. §7 rule 3 is undo, not
 * confirm, and the queue can now hand the change back (`restore`), so the
 * discard says what went and holds the way back open for the same window
 * every other undo gets (`undoHoldMs`).
 *
 * One hook for the three places that discard — the sync banner, the unsaved
 * page and the reconcile dialog — so the promise is the same in all of them.
 */
export function useDiscardChange(): (op: FailedOp) => void {
  const { discard, restore } = useWriteQueue();
  const snackbar = useSnackbar();
  const t = useTranslations();

  return (op) => {
    const removed = discard(op.id);
    if (!removed) return;

    snackbar.show({
      kind: "undo-inverse",
      message: {
        key: "offline.discarded",
        // The change's own label, rendered now: it is a sentence inside a
        // sentence, and the snackbar renders one key.
        values: { label: t(op.label.key, op.label.values) },
      },
      undo: () => restore(removed),
      durationMs: undoHoldMs(),
    });
  };
}
