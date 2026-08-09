"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";

interface ProductCandidate {
  productId: string;
  name: string;
  similarity: number;
}

interface MatchSelectorProps {
  candidates: ProductCandidate[];
  selectedId: string | null;
  onSelect: (productId: string) => void;
  autoMatch: { id: string; name: string } | null;
}

export function MatchSelector({
  candidates,
  selectedId,
  onSelect,
  autoMatch,
}: MatchSelectorProps) {
  const t = useTranslations("receipts");
  const locale = useLocale();

  const formatScore = (score: number) => {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(score);
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.7) return "text-ok-foreground";
    if (score >= 0.5) return "text-warn-foreground";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">
        {t("matchesFound")}
      </p>

      {autoMatch && (
        <div className="rounded border border-border bg-muted p-2 text-sm text-foreground">
          {t("bestAutoMatch")} <strong>{autoMatch.name}</strong>
        </div>
      )}

      <div className="space-y-1">
        {candidates.map((candidate) => (
          <button
            type="button"
            key={candidate.productId}
            onClick={() => onSelect(candidate.productId)}
            className={`w-full flex items-center justify-between p-2 rounded border text-left transition-colors ${
              selectedId === candidate.productId
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            <div className="flex items-center gap-2">
              {selectedId === candidate.productId && (
                <Check className="w-4 h-4 text-primary" />
              )}
              <span className="text-sm">{candidate.name}</span>
            </div>
            <span className={`text-xs font-medium ${getScoreColor(candidate.similarity)}`}>
              {formatScore(candidate.similarity)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
