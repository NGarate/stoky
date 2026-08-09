"use client";

import { ReceiptStatus } from "@prisma/client";
import { Loader2, CheckCircle, AlertCircle, Check } from "lucide-react";

interface ReceiptStatusProps {
  status: ReceiptStatus;
  progress?: {
    total: number;
    processed: number;
  };
}

const statusConfig = {
  [ReceiptStatus.UPLOADING]: {
    label: "Subiendo...",
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    icon: Loader2,
    spin: true,
  },
  [ReceiptStatus.PROCESSING]: {
    label: "Procesando OCR...",
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    icon: Loader2,
    spin: true,
  },
  [ReceiptStatus.PARSED]: {
    label: "Analizando...",
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    icon: Loader2,
    spin: true,
  },
  [ReceiptStatus.NEEDS_REVIEW]: {
    label: "Necesita revisión",
    color: "text-warn-foreground",
    bgColor: "bg-warn",
    icon: AlertCircle,
    spin: false,
  },
  [ReceiptStatus.CONFIRMED]: {
    label: "Confirmado",
    color: "text-ok-foreground",
    bgColor: "bg-ok",
    icon: CheckCircle,
    spin: false,
  },
  [ReceiptStatus.APPLIED]: {
    label: "Aplicado",
    color: "text-ok-foreground",
    bgColor: "bg-ok",
    icon: Check,
    spin: false,
  },
  [ReceiptStatus.FAILED]: {
    label: "Error",
    color: "text-danger-foreground",
    bgColor: "bg-danger",
    icon: AlertCircle,
    spin: false,
  },
};

export function ReceiptStatusBadge({ status, progress }: ReceiptStatusProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${config.bgColor}`}>
      <Icon className={`w-4 h-4 ${config.color} ${config.spin ? "animate-spin" : ""}`} />
      <span className={`text-sm font-medium ${config.color}`}>
        {config.label}
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

export function ReceiptStatusStep({ status }: ReceiptStatusStepProps) {
  const steps = [
    { id: ReceiptStatus.UPLOADING, label: "Subida" },
    { id: ReceiptStatus.PROCESSING, label: "OCR" },
    { id: ReceiptStatus.PARSED, label: "Análisis" },
    { id: ReceiptStatus.NEEDS_REVIEW, label: "Revisión" },
    { id: ReceiptStatus.CONFIRMED, label: "Confirmado" },
    { id: ReceiptStatus.APPLIED, label: "Aplicado" },
  ];

  const currentIndex = steps.findIndex((s) => s.id === status);

  return (
    <div className="flex items-center justify-between">
      {steps.map((step, index) => {
        const isActive = index <= currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <div key={step.id} className="flex items-center">
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
              <span className="text-xs mt-1">{step.label}</span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`w-8 h-0.5 mx-1 ${
                  index < currentIndex ? "bg-primary" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
