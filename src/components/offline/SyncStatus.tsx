"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { syncStatus, isUrgent } from "@/lib/offline/status";
import { useWriteQueue } from "@/lib/offline/queue-context";
import { useQuantityFormat } from "@/lib/inventory/quantity";
import { ReconcileDialog } from "./ReconcileDialog";
import { useDiscardChange } from "./useDiscardChange";
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
  // Op labels carry their full key — `offline.tickedOff`, `shopping.itemUpdated` —
  // and are rendered from the root, as the snackbar renders them. Read through
  // the `offline` namespace with the prefix stripped, any label from another
  // namespace was shown raw: "offline.shopping.itemUpdated".
  const tLabel = useTranslations();
  const units = useQuantityFormat();
  const { state, drain, retry } = useWriteQueue();
  const discardChange = useDiscardChange();
  const [reconciling, setReconciling] = useState<FailedOp | null>(null);

  const summary = syncStatus(state);
  const urgent = isUrgent(summary.state);

  const toReconcile = state.failed.filter(
    (op) => op.reason === "needs-reconciliation",
  );
  const toReview = state.failed.filter((op) => op.reason === "needs-review");
  const otherFailures = state.failed.filter(
    (op) =>
      op.reason !== "needs-reconciliation" && op.reason !== "needs-review",
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
              : summary.state === "needs-review"
                ? t("needsReview", { count: summary.count })
                : summary.state === "failed"
                  ? t("failed", { count: summary.count })
                  : summary.state === "unsaved"
                    ? t("unsaved", { count: summary.count })
                    : summary.state === "full"
                      ? t("full")
                      : t("unrepresented");

  return (
    // `data-sync` separates "the device has been read and there is nothing
    // waiting" from "the device has not been read yet". Both render the same
    // thing — nothing — because there is nothing honest to show for a state
    // that lasts one effect, and a spinner for it would be worse than silence.
    // What it stops is anything *else* reading the empty region as proof that
    // everything is saved, which a browser test did, and which is only going to
    // happen more often as the shell starts arriving before hydration.
    <div
      className="mb-4"
      data-sync={state.hydrated ? "ready" : "hydrating"}
      data-testid="sync-status"
    >
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
                      {tLabel(op.label.key, units.labelValues(op.label.values))}
                    </span>
                    <Button onClick={() => setReconciling(op)} type="button">
                      {t("review")}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}

            {toReview.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {toReview.map((op) => (
                  <li key={op.id} className="flex flex-wrap items-center gap-2">
                    <span className="flex-1">
                      {tLabel(op.label.key, units.labelValues(op.label.values))}
                    </span>
                    {/* The barcode carries into the create form, which
                        discards this queued scan once the product is named. */}
                    <Button asChild type="button">
                      <Link
                        href={`/products/new?barcode=${encodeURIComponent(
                          String(op.input.barcode ?? ""),
                        )}&pendingScan=${op.id}`}
                      >
                        {t("nameIt")}
                      </Link>
                    </Button>
                    {/* Discarding deletes an unsent change once its undo has
                        gone, so it wears the colour that says so — and names
                        the change, because every row's button says the same
                        word. */}
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
                  </li>
                ))}
              </ul>
            ) : null}

            {otherFailures.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {otherFailures.map((op) => (
                  <li key={op.id} className="flex flex-wrap items-center gap-2">
                    <span className="flex-1">
                      {tLabel(op.label.key, units.labelValues(op.label.values))}
                    </span>
                    <Button onClick={() => retry(op.id)} type="button">
                      {t("retry")}
                    </Button>
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
                  </li>
                ))}
              </ul>
            ) : null}

            {/* Where the same changes can be found deliberately, with when
                each one was made — which a banner cannot say. */}
            {state.failed.length > 0 ? (
              <Button asChild className="mt-3 mr-2" variant="outline">
                <Link href="/settings/unsaved"> {t("seeUnsaved")} </Link>
              </Button>
            ) : null}

            {summary.state === "needs-signin" ? (
              /* The one thing that helps. "Enviar ahora" was the only control
                 here, and the drain returns at once while the session is
                 expired — a button that does nothing, under a message saying
                 to sign in with nowhere to do it. A plain anchor rather than
                 `Link`: signing in sets a new session cookie, and a full
                 navigation is what makes every layer read it. */
              <Button asChild>
                <a href="/login">{t("signInAgain")}</a>
              </Button>
            ) : (
              /* The only honest answer to a captive portal, which reports
                 itself as online and swallows every request. */
              <Button onClick={drain} type="button">
                {t("sendNow")}
              </Button>
            )}
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
