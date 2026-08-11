"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { syncStatus, isUrgent } from "@/lib/offline/status";
import { useWriteQueue } from "./queue-context";
import { ReconcileDialog } from "./ReconcileDialog";
import type { FailedOp } from "@/lib/offline/queue";
import type { JSX } from "react";

/**
 * What is waiting, in words.
 *
 * **Two permanent sibling live regions**, and each state is put in the one that
 * owns it: the calm ones in `status`, the ones needing a person in `alert`.
 * Not one node whose role changes — swapping a live region's role mid-life is
 * unreliable across screen readers, and a rendered test would pass it happily.
 *
 * Every state has text. Never a bare icon, never colour alone
 * (`REDESIGN_PLAN.md` §7 rule 2, and the WCAG floor this project holds itself
 * to).
 *
 * The reconciliation opens from here rather than interrupting when the
 * conflict is discovered. A conflict is found on *reconnect* — minutes after
 * the shop, phone in a pocket — and a dialog thrown then interrupts someone who
 * cannot answer it (§7 rule 3, PROGRESS D44). Carried here, it survives being
 * ignored for an hour, which is the realistic case.
 */
export function SyncStatus(): JSX.Element {
  const t = useTranslations("offline");
  const { state, drain, retry, discard } = useWriteQueue();
  const [reconciling, setReconciling] = useState<FailedOp | null>(null);

  const summary = syncStatus(state);
  const urgent = isUrgent(summary.state);

  const toReconcile = state.failed.filter(
    (op) => op.reason === "needs-reconciliation",
  );
  const otherFailures = state.failed.filter(
    (op) => op.reason !== "needs-reconciliation",
  );

  const message =
    summary.state === "synced"
      ? ""
      : summary.state === "pending"
        ? t("pending", { count: summary.count })
        : summary.state === "syncing"
          ? t("syncing")
          : summary.state === "needs-signin"
            ? t("needsSignin")
            : summary.state === "needs-reconciliation"
              ? t("needsReconciliation", { count: summary.count })
              : summary.state === "failed"
                ? t("failed", { count: summary.count })
                : summary.state === "full"
                  ? t("full")
                  : t("unrepresented");

  return (
    <div className="mb-4" data-testid="sync-status">
      {/* Both regions exist for every state. A region created at the moment it
          has something to say is a region screen readers may not announce.

          The test ids exist because Next mounts its own route announcer with
          `role="alert"`, so a browser test asking for the alert region by role
          alone gets two elements and a strict-mode violation. */}
      <div aria-live="polite" data-testid="sync-calm" role="status">
        {!urgent && summary.state !== "synced" ? (
          <p className="rounded-lg border border-input bg-card px-4 py-3 text-sm text-foreground">
            {message}
          </p>
        ) : null}
      </div>

      <div aria-live="assertive" data-testid="sync-urgent" role="alert">
        {urgent ? (
          <div className="rounded-lg border border-warn-foreground bg-warn px-4 py-3 text-sm text-warn-foreground">
            <p>{message}</p>

            {summary.state === "needs-reconciliation" ? (
              <ul className="mt-3 space-y-2">
                {toReconcile.map((op) => (
                  <li key={op.id} className="flex flex-wrap items-center gap-2">
                    <span className="flex-1">
                      {t(op.label.key.replace("offline.", ""), op.label.values)}
                    </span>
                    <button
                      className="min-h-[48px] rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
                      onClick={() => setReconciling(op)}
                      type="button"
                    >
                      {t("review")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {otherFailures.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {otherFailures.map((op) => (
                  <li key={op.id} className="flex flex-wrap items-center gap-2">
                    <span className="flex-1">
                      {t(op.label.key.replace("offline.", ""), op.label.values)}
                    </span>
                    <button
                      className="min-h-[48px] rounded-md border border-input bg-card px-4 py-2 text-foreground hover:bg-muted"
                      onClick={() => retry(op.id)}
                      type="button"
                    >
                      {t("retry")}
                    </button>
                    <button
                      className="min-h-[48px] rounded-md border border-input bg-card px-4 py-2 text-foreground hover:bg-muted"
                      onClick={() => discard(op.id)}
                      type="button"
                    >
                      {t("discard")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {/* The only honest answer to a captive portal, which reports
                itself as online and swallows every request. */}
            <button
              className="mt-3 min-h-[48px] rounded-md border border-input bg-card px-4 py-2 text-foreground hover:bg-muted"
              onClick={drain}
              type="button"
            >
              {t("sendNow")}
            </button>
          </div>
        ) : null}
      </div>

      {reconciling ? (
        <ReconcileDialog
          onClose={() => setReconciling(null)}
          op={reconciling}
        />
      ) : null}
    </div>
  );
}
