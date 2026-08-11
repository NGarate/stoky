"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/trpc/client";
import { useWriteQueue } from "./queue-context";
import type { FailedOp } from "@/lib/offline/queue";
import type { FormEvent, JSX } from "react";

/**
 * The question a refused consumption becomes.
 *
 * Stock has a floor, so two people who each use the last unit cannot both be
 * right and the second is refused. Reporting that as "it did not save" throws
 * away a real event — they *did* take the milk. What is left is a question only
 * a person can answer: the count and the house disagree, and someone has to
 * look at the shelf (`REDESIGN_PLAN.md` §5.5.3).
 *
 * The answer is written as an `adjustStock`, which is the primitive that exists
 * for "the count is wrong and here is the truth". It asks for an **absolute**
 * amount, because that is the question a person can answer standing in front of
 * a fridge; the delta against what the server holds is arithmetic, and
 * arithmetic is our job rather than theirs.
 *
 * A direct mutation, not a queued one. A conflict is only ever discovered when
 * there is a connection, so there is nothing to queue against — and
 * `adjustStock` is deliberately not replayable (it is absolute-valued, so
 * replaying one is not the same as applying it once).
 */
export function ReconcileDialog({
  op,
  onClose,
}: {
  op: FailedOp;
  onClose: () => void;
}): JSX.Element {
  const t = useTranslations("offline");
  const { discard } = useWriteQueue();
  const fieldId = useId();
  const hintId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  const input = op.input as {
    productId?: string;
    quantity?: number;
    unit?: string;
  };

  const product = api.product.getById.useQuery(
    { id: input.productId ?? "" },
    { enabled: Boolean(input.productId) },
  );

  const [amount, setAmount] = useState("");
  const [failed, setFailed] = useState(false);

  const adjust = api.inventory.adjustStock.useMutation({
    onSuccess: () => {
      // The change is answered, so it leaves the queue rather than sitting
      // there as a permanent complaint.
      discard(op.id);
      onClose();
    },
    onError: () => setFailed(true),
  });

  // Focus moves in when it opens, so the keyboard and a screen reader land on
  // the question rather than back at the top of the page.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const netStock = (product.data?.stockEntries ?? []).reduce(
    (sum, entry) => sum + entry.quantity,
    0,
  );

  /** A KITCHEN account may look and consume, and not adjust. */
  const mayAdjust = product.error === null;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const actual = Number(amount);
    if (!Number.isFinite(actual) || actual < 0 || !input.productId) return;

    setFailed(false);
    adjust.mutate({
      productId: input.productId,
      // The delta, computed from what they told us is there.
      quantity: Math.round((actual - netStock) * 100) / 100,
      unit: input.unit ?? product.data?.defaultUnit ?? "unit",
      reason: t("reconcileReason"),
    });
  }

  return (
    <div
      aria-labelledby={`${fieldId}-title`}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
        ref={dialogRef}
        tabIndex={-1}
      >
        <h2
          className="text-lg font-semibold text-heading"
          id={`${fieldId}-title`}
        >
          {t("reconcileTitle")}
        </h2>

        <p className="mt-2 text-sm text-muted-foreground">
          {t("reconcileBody", {
            quantity: input.quantity ?? 0,
            unit: input.unit ?? "",
            name: product.data?.name ?? String(op.label.values?.name ?? ""),
          })}
        </p>

        {mayAdjust ? (
          <form className="mt-4" onSubmit={handleSubmit}>
            <label
              className="block text-sm font-medium text-foreground"
              htmlFor={`${fieldId}-amount`}
            >
              {t("reconcileQuestion")}
            </label>
            <input
              aria-describedby={hintId}
              className="mt-1 min-h-[48px] w-full rounded-md border border-input bg-card px-3 py-2 text-foreground"
              id={`${fieldId}-amount`}
              inputMode="decimal"
              min="0"
              onChange={(event) => setAmount(event.target.value)}
              required
              step="0.01"
              type="number"
              value={amount}
            />
            <p className="mt-1 text-sm text-muted-foreground" id={hintId}>
              {t("reconcileHint")}
            </p>

            {failed ? (
              <p
                aria-live="polite"
                className="mt-3 rounded-md border border-danger-foreground bg-danger px-3 py-2 text-sm text-danger-foreground"
              >
                {t("reconcileFailed")}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="min-h-[48px] rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={adjust.isPending || amount.trim() === ""}
                type="submit"
              >
                {adjust.isPending ? t("reconcileSaving") : t("reconcileSubmit")}
              </button>
              <button
                className="min-h-[48px] rounded-md border border-input bg-card px-4 py-2 text-foreground hover:bg-muted"
                onClick={() => {
                  discard(op.id);
                  onClose();
                }}
                type="button"
              >
                {t("reconcileDiscard")}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4">
            {/* Not a hidden button: a control the server would refuse is worse
                than no control. The matrix gives KITCHEN looking and
                consuming, and this says who can do the rest. */}
            <p className="text-sm text-foreground">{t("reconcileKitchen")}</p>
            <button
              className="mt-4 min-h-[48px] rounded-md border border-input bg-card px-4 py-2 text-foreground hover:bg-muted"
              onClick={onClose}
              type="button"
            >
              {t("refresh")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
