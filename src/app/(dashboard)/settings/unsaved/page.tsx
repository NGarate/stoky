"use client";

import { useLocale, useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ItemRow } from "@/components/ui/item-row";
import { useWriteQueue } from "@/lib/offline/queue-context";
import { useQuantityFormat } from "@/lib/inventory/quantity";
import { ReconcileDialog } from "@/components/offline/ReconcileDialog";
import { useDiscardChange } from "@/components/offline/useDiscardChange";
import type { FailedOp, FailureReason } from "@/lib/offline/queue";
import type { JSX } from "react";
import { formatDateTime } from "@/lib/dates";

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

/**
 * What state the change is in, as a badge.
 *
 * `warn` for the two that are questions for a person — reconcile, or name a
 * scan — and `danger` for the rest, which did not save. The reason below says
 * the same in a sentence, so the tone is never the only carrier.
 */
function statusOf(reason: FailureReason): {
  tone: "warn" | "danger";
  key: "unsavedStatusCheck" | "unsavedStatusName" | "unsavedStatusFailed";
} {
  if (reason === "needs-reconciliation")
    return { tone: "warn", key: "unsavedStatusCheck" };
  if (reason === "needs-review")
    return { tone: "warn", key: "unsavedStatusName" };
  return { tone: "danger", key: "unsavedStatusFailed" };
}

/** Why it is not going to be sent again, in words rather than a code. */
const REASON_KEY: Record<FailureReason, string> = {
  "needs-reconciliation": "reasonNeedsReconciliation",
  "needs-review": "reasonNeedsReview",
  "wrong-household": "reasonWrongHousehold",
  refused: "reasonRefused",
  gone: "reasonGone",
  invalid: "reasonInvalid",
  exhausted: "reasonExhausted",
};

export default function UnsavedPage(): JSX.Element {
  const t = useTranslations("offline");
  // Op labels carry their full key — `offline.tickedOff`, `shopping.itemUpdated` —
  // and are rendered from the root, as the snackbar renders them. Read through
  // the `offline` namespace with the prefix stripped, any label from another
  // namespace was shown raw: "offline.shopping.itemUpdated".
  const tLabel = useTranslations();
  const units = useQuantityFormat();
  const locale = useLocale();
  const { state, retry } = useWriteQueue();
  const discardChange = useDiscardChange();
  const [reconciling, setReconciling] = useState<FailedOp | null>(null);

  const failed = state.failed;

  return (
    <PageShell width="form">
      <PageHeader
        back={{ href: "/settings", label: t("backToSettings") }}
        intro={failed.length > 0 ? t("unsavedIntro") : undefined}
        title={t("unsavedTitle")}
      />

      {failed.length === 0 ? (
        <EmptyState body={t("unsavedEmptyHint")} title={t("unsavedEmpty")} />
      ) : (
        <>
          {/* `ItemRow`, the one list row: a hand-written card per change had
              its own title, its own meta paragraphs and no status at all. */}
          <ul className="mt-6 space-y-4">
            {failed.map((op) => (
              <ItemRow
                key={op.id}
                meta={[
                  {
                    label: t("unsavedWhenLabel"),
                    value: formatDateTime(locale, op.createdAt),
                  },
                  {
                    label: t("unsavedWhyLabel"),
                    value: t(REASON_KEY[op.reason]),
                  },
                ]}
                status={
                  <Badge tone={statusOf(op.reason).tone}>
                    {t(statusOf(op.reason).key)}
                  </Badge>
                }
                title={tLabel(op.label.key, units.labelValues(op.label.values))}
                actions={
                  <>
                    {op.reason === "needs-reconciliation" ? (
                      <Button onClick={() => setReconciling(op)} type="button">
                        {t("review")}
                      </Button>
                    ) : (
                      <Button onClick={() => retry(op.id)} type="button">
                        {t("retry")}
                      </Button>
                    )}

                    {/* Deletes the change once its undo has gone, so it is not
                        drawn in the colour of the retry beside it — and names
                        the change, because every row's says the same word. */}
                    <Button
                      aria-label={t("discardNamed", {
                        label: tLabel(op.label.key, op.label.values),
                      })}
                      onClick={() => discardChange(op)}
                      type="button"
                      variant="destructive"
                    >
                      {t("discard")}
                    </Button>
                  </>
                }
              />
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
    </PageShell>
  );
}
