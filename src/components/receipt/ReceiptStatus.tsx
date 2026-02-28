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
    color: "text-blue-500",
    bgColor: "bg-blue-50",
    icon: Loader2,
    spin: true,
  },
  [ReceiptStatus.PROCESSING]: {
    label: "Procesando OCR...",
    color: "text-yellow-500",
    bgColor: "bg-yellow-50",
    icon: Loader2,
    spin: true,
  },
  [ReceiptStatus.PARSED]: {
    label: "Analizando...",
    color: "text-purple-500",
    bgColor: "bg-purple-50",
    icon: Loader2,
    spin: true,
  },
  [ReceiptStatus.NEEDS_REVIEW]: {
    label: "Necesita revisión",
    color: "text-orange-500",
    bgColor: "bg-orange-50",
    icon: AlertCircle,
    spin: false,
  },
  [ReceiptStatus.CONFIRMED]: {
    label: "Confirmado",
    color: "text-green-500",
    bgColor: "bg-green-50",
    icon: CheckCircle,
    spin: false,
  },
  [ReceiptStatus.APPLIED]: {
    label: "Aplicado",
    color: "text-green-600",
    bgColor: "bg-green-100",
    icon: Check,
    spin: false,
  },
  [ReceiptStatus.FAILED]: {
    label: "Error",
    color: "text-red-500",
    bgColor: "bg-red-50",
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
        <span className="text-xs text-gray-500">
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
                isActive ? "text-blue-600" : "text-gray-400"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  isCurrent
                    ? "bg-blue-600 text-white"
                    : isActive
                      ? "bg-blue-100 text-blue-600"
                      : "bg-gray-100 text-gray-400"
                }`}
              >
                {index + 1}
              </div>
              <span className="text-xs mt-1">{step.label}</span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`w-8 h-0.5 mx-1 ${
                  index < currentIndex ? "bg-blue-600" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
