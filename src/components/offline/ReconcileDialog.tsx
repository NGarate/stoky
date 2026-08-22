"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tabbableWithin } from "@/lib/focus";
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
 * **It keeps the promise `aria-modal` makes.** It did not: the attribute was
 * there and nothing behind it was — no Escape, no Tab trap, no focus returned
 * on close, and `role="dialog"` on the full-viewport scrim rather than on the
 * card. `aria-modal="true"` tells assistive technology that everything
 * outside is unavailable, so tabbing past the last button walked into content
 * the reader had been told to ignore; and with no cancel control and no
 * Escape, the only keyboard ways out were submitting an adjustment or
 * pressing the button that throws the queued change away.
 *
 * The behaviour is `NavSheet`'s, which has been doing this correctly in this
 * codebase since the compact tiers landed — the same `tabbableWithin` trap,
 * the same Escape, the same restoration of the opener on unmount. Not the
 * `Dialog` primitive, though it is the better home: migrating this panel to
 * Radix wedges the component suite, spinning at 100% of a core whenever
 * `error-boundary.test.tsx` is loaded in the same process, and a stuck gate
 * is worse than a hand-rolled panel that behaves. That is written down rather
 * than left as a shrug — the migration is still worth doing once the
 * interaction is understood.
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
  const tCommon = useTranslations("common");
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

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const panel = dialogRef.current;
      if (!panel) return;

      // Tab stops rather than focusable elements: a radio group is one stop,
      // and a `last` the browser never reaches is a wrap that never fires.
      const stops = tabbableWithin(panel);
      if (stops.length === 0) return;

      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;

      // `active === panel` is the state it opens in — focus is on the card
      // itself, which is before every control in it, so shift+Tab from there
      // is a backwards exit and wraps the same way.
      const atStart = active === first || active === panel;

      if (event.shiftKey && (atStart || !panel.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    // Whoever opened it gets focus back on close, or the keyboard user is
    // dumped at the top of the document and starts again.
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    // Focus moves in when it opens, so the keyboard and a screen reader land
    // on the question rather than back at the top of the page.
    dialogRef.current?.focus();
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      opener?.focus();
    };
  }, [handleKeyDown]);

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
    // The scrim is decoration and says so. `role="dialog"` and `aria-modal`
    // sat here, on a full-viewport box, so the dialog's accessible name
    // covered the whole screen and the card inside it was just content.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div
        aria-labelledby={`${fieldId}-title`}
        aria-modal="true"
        className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {/* A way out that is neither "save" nor "throw it away". With no
            Escape and no cancel, those two were the only keyboard exits from
            a panel that had declared everything else unavailable. */}
        <Button
          aria-label={tCommon("close")}
          className="absolute top-2 right-2"
          onClick={onClose}
          size="icon"
          type="button"
          variant="ghost"
        >
          <span aria-hidden="true">✕</span>
        </Button>

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
            <Input
              aria-describedby={hintId}
              className="mt-1"
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
              <Button
                disabled={adjust.isPending || amount.trim() === ""}
                type="submit"
              >
                {adjust.isPending ? t("reconcileSaving") : t("reconcileSubmit")}
              </Button>
              <Button
                onClick={() => {
                  discard(op.id);
                  onClose();
                }}
                type="button"
              >
                {t("reconcileDiscard")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-4">
            {/* Not a hidden button: a control the server would refuse is worse
                than no control. The matrix gives KITCHEN looking and
                consuming, and this says who can do the rest. */}
            <p className="text-sm text-foreground">{t("reconcileKitchen")}</p>
            <Button
              onClick={onClose}
              type="button"
            >
              {t("refresh")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
