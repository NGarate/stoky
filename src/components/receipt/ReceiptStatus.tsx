"use client";

import { ReceiptStatus } from "@prisma/client";
import { useTranslations } from "next-intl";
import { Loader2, CheckCircle, AlertCircle, Check } from "lucide-react";

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
 */
const statusConfig = {
  [ReceiptStatus.UPLOADING]: {
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    icon: Loader2,
    spin: true,
  },
  [ReceiptStatus.PROCESSING]: {
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    icon: Loader2,
    spin: true,
  },
  [ReceiptStatus.PARSED]: {
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    icon: Loader2,
    spin: true,
  },
  [ReceiptStatus.NEEDS_REVIEW]: {
    color: "text-warn-foreground",
    bgColor: "bg-warn",
    icon: AlertCircle,
    spin: false,
  },
  [ReceiptStatus.CONFIRMED]: {
    color: "text-ok-foreground",
    bgColor: "bg-ok",
    icon: CheckCircle,
    spin: false,
  },
  [ReceiptStatus.APPLIED]: {
    color: "text-ok-foreground",
    bgColor: "bg-ok",
    icon: Check,
    spin: false,
  },
  [ReceiptStatus.FAILED]: {
    color: "text-danger-foreground",
    bgColor: "bg-danger",
    icon: AlertCircle,
    spin: false,
  },
};

export function ReceiptStatusBadge({ status, progress }: ReceiptStatusProps) {
  const t = useTranslations("receipts.status");
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${config.bgColor}`}>
      <Icon className={`w-4 h-4 ${config.color} ${config.spin ? "animate-spin" : ""}`} />
      <span className={`text-sm font-medium ${config.color}`}>
        {t(status.toLowerCase())}
      </span>
      {progress && status !== ReceiptStatus.APPLIED && (
        <span className="text-xs text-muted-foreground">
          ({progress.processed}/{progress.total})
        </span>
      )}
    </div>
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
