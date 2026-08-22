"use client";

import { ReceiptStatus } from "@prisma/client";
import { useTranslations } from "next-intl";
import { Loader2, CheckCircle, AlertCircle, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";

interface ReceiptStatusProps {
  status: ReceiptStatus;
  progress?: {
    total: number;
    processed: number;
  };
}

/**
 * Presentation only. The wording lives in `receipts.status.*`, which the applied
 * summary already reads, so the badge and that page cannot drift apart.
 *
 * The pill itself is `<Badge>` now. This was a hand-written
 * `rounded-full px-3 py-1.5` with its own fill and its own foreground — a
 * fifth size and a second rounding for the same object the design system
 * exists to own, and a colour pair `check-contrast.ts` audits only because
 * the tokens happened to be the same ones.
 *
 * `tone` rather than a colour: the four waiting states are not a state of
 * health, so they are `neutral`; needing review is the one that wants
 * attention; confirmed and applied are `ok`; failed is `danger`.
 */
const statusConfig = {
  [ReceiptStatus.UPLOADING]: { tone: "neutral", icon: Loader2, spin: true },
  [ReceiptStatus.PROCESSING]: { tone: "neutral", icon: Loader2, spin: true },
  [ReceiptStatus.PARSED]: { tone: "neutral", icon: Loader2, spin: true },
  [ReceiptStatus.NEEDS_REVIEW]: { tone: "warn", icon: AlertCircle, spin: false },
  [ReceiptStatus.CONFIRMED]: { tone: "ok", icon: CheckCircle, spin: false },
  [ReceiptStatus.APPLIED]: { tone: "ok", icon: Check, spin: false },
  [ReceiptStatus.FAILED]: { tone: "danger", icon: AlertCircle, spin: false },
} as const;

export function ReceiptStatusBadge({ status, progress }: ReceiptStatusProps) {
  const t = useTranslations("receipts.status");
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge tone={config.tone}>
      <span className="inline-flex items-center gap-2">
        <Icon
          aria-hidden="true"
          className={`h-4 w-4 ${config.spin ? "animate-spin" : ""}`}
        />
        {t(status.toLowerCase())}
        {progress && status !== ReceiptStatus.APPLIED ? (
          <span>
            ({progress.processed}/{progress.total})
          </span>
        ) : null}
      </span>
    </Badge>
  );
}

interface ReceiptStatusStepProps {
  status: ReceiptStatus;
}

/** The pipeline in order. `FAILED` is not on it, so it has no position. */
const STEPS = [
  ReceiptStatus.UPLOADING,
  ReceiptStatus.PROCESSING,
  ReceiptStatus.PARSED,
  ReceiptStatus.NEEDS_REVIEW,
  ReceiptStatus.CONFIRMED,
  ReceiptStatus.APPLIED,
] as const;

/**
 * Where a receipt is in the pipeline, rendered two ways.
 *
 * Six numbered circles and five connectors need about 505px, so on a 390px
 * phone the row ran off the side of the document and took the last step —
 * "Aplicado", the one the reviewer is heading for — with it (ISSUES UI-5). The
 * whole page scrolled sideways as a result.
 *
 * Below `md` it therefore collapses to the one fact a phone actually needs:
 * which step you are on, by number and by name. The full ladder returns from
 * `md`, where there is room for it. Only one of the two is in the DOM tree that
 * matters at any width — `hidden` is `display:none`, so the hidden one is out
 * of the accessibility tree too and nothing is announced twice.
 */
export function ReceiptStatusStep({ status }: ReceiptStatusStepProps) {
  const t = useTranslations("receipts");
  const currentIndex = STEPS.indexOf(status as (typeof STEPS)[number]);

  return (
    <div>
      <div className="md:hidden">
        {currentIndex < 0 ? (
          <p className="text-sm font-medium text-danger-foreground">
            {t("stepFailed")}
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
              {currentIndex + 1}
            </span>
            <p className="text-sm font-medium text-foreground">
              {t("stepSummary", {
                current: currentIndex + 1,
                total: STEPS.length,
                label: t(`steps.${status.toLowerCase()}`),
              })}
            </p>
          </div>
        )}
      </div>

      <div
        aria-label={t("stepsLabel")}
        className="hidden md:flex md:items-center md:justify-between"
        role="group"
      >
        {STEPS.map((step, index) => {
          const isActive = index <= currentIndex;
          const isCurrent = index === currentIndex;

          return (
            <div key={step} className="flex items-center">
              <div
                className={`flex flex-col items-center ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isActive
                        ? "bg-accent text-primary"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {index + 1}
                </div>
                <span className="text-xs mt-1">
                  {t(`steps.${step.toLowerCase()}`)}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={`w-8 h-0.5 mx-1 shrink ${
                    index < currentIndex ? "bg-primary" : "bg-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
