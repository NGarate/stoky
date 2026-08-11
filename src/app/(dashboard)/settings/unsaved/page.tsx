"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { useWriteQueue } from "@/components/offline/queue-context";
import { ReconcileDialog } from "@/components/offline/ReconcileDialog";
import type { FailedOp, FailureReason } from "@/lib/offline/queue";
import type { JSX } from "react";

/**
 * Everything that did not save, in one place.
 *
 * The sync indicator names failures inline, which is right for the moment they
 * happen and wrong for an hour later: it is above the content of whatever
 * screen you are on, it is a banner, and it does not say *when* anything was
 * recorded. A change somebody made in a supermarket and could not send
 * deserves a page it can be found on deliberately.
 *
 * Nothing here is a duplicate control. Retry and discard are the queue's, the
 * reconciliation is the same dialog the indicator opens, and this route is the
 * only place that says when each change was made — which is the thing that
 * makes "was this the milk from Tuesday?" answerable.
 */

/** Why it is not going to be sent again, in words rather than a code. */
const REASON_KEY: Record<FailureReason, string> = {
  "needs-reconciliation": "reasonNeedsReconciliation",
  "wrong-household": "reasonWrongHousehold",
  refused: "reasonRefused",
  gone: "reasonGone",
  invalid: "reasonInvalid",
  exhausted: "reasonExhausted",
};

export default function UnsavedPage(): JSX.Element {
  const t = useTranslations("offline");
  const format = useFormatter();
  const { state, retry, discard } = useWriteQueue();
  const [reconciling, setReconciling] = useState<FailedOp | null>(null);

  const failed = state.failed;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-heading md:text-4xl">
          {t("unsavedTitle")}
        </h1>
        <Link
          className="inline-flex min-h-[48px] items-center text-primary hover:underline"
          href="/settings"
        >
          {t("backToSettings")}
        </Link>
      </div>

      {failed.length === 0 ? (
        <div className="rounded-xl border border-ok-foreground bg-ok p-6">
          <p className="text-ok-foreground">{t("unsavedEmpty")}</p>
          <p className="mt-2 text-sm text-ok-foreground">
            {t("unsavedEmptyHint")}
          </p>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground">{t("unsavedIntro")}</p>

          <ul className="mt-6 space-y-4">
            {failed.map((op) => (
              <li
                key={op.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <p className="font-medium text-foreground">
                  {t(op.label.key.replace("offline.", ""), op.label.values)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("unsavedWhen", {
                    date: format.dateTime(op.createdAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {t(REASON_KEY[op.reason])}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {op.reason === "needs-reconciliation" ? (
                    <button
                      className="min-h-[48px] rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
                      onClick={() => setReconciling(op)}
                      type="button"
                    >
                      {t("review")}
                    </button>
                  ) : (
                    <button
                      className="min-h-[48px] rounded-md border border-input bg-card px-4 py-2 text-foreground hover:bg-muted"
                      onClick={() => retry(op.id)}
                      type="button"
                    >
                      {t("retry")}
                    </button>
                  )}

                  <button
                    className="min-h-[48px] rounded-md border border-input bg-card px-4 py-2 text-foreground hover:bg-muted"
                    onClick={() => discard(op.id)}
                    type="button"
                  >
                    {t("discard")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {reconciling ? (
        <ReconcileDialog
          onClose={() => setReconciling(null)}
          op={reconciling}
        />
      ) : null}
    </div>
  );
}
