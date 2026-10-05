"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

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

      {/* `aria-pressed` on each candidate, which is what makes the choice
          exist for anyone not looking at it.
          These are mutually exclusive and the selected one was marked by a
          tint and a tick — and `lucide-react` gives an unlabelled icon
          `aria-hidden`, so the tick is invisible to a screen reader too. The
          announced output for the chosen candidate was byte-identical to the
          ones beside it: three candidates for a receipt line, tab through
          them, and no way to tell which one you just picked before pressing
          "Confirmar" (WCAG 4.1.2).
          `aria-pressed` rather than a radiogroup deliberately. A radiogroup
          is the more precise role and brings a keyboard model with it —
          roving tabindex, arrow keys — which is a widget rather than a fix.
          `ShopRow` on /shopping already states a selection this way, so this
          is the convention here rather than a new one. */}
      <div className="space-y-1">
        {candidates.map((candidate) => (
          // `Button`, so the 48px floor and the focus ring are the
          // primitive's rather than a hand-styled 36px row's. Outline
          // throughout — a candidate is a choice, not a commit — with the
          // chosen one bordered in the primary colour beside its tick.
          <Button
            aria-pressed={selectedId === candidate.productId}
            type="button"
            key={candidate.productId}
            onClick={() => onSelect(candidate.productId)}
            variant="outline"
            className={`h-auto w-full justify-between whitespace-normal text-left ${
              selectedId === candidate.productId ? "border-primary bg-accent" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              {selectedId === candidate.productId && (
                <Check aria-hidden="true" className="w-4 h-4 text-primary" />
              )}
              <span className="text-sm">{candidate.name}</span>
            </div>
            <span className={`text-xs font-medium ${getScoreColor(candidate.similarity)}`}>
              {formatScore(candidate.similarity)}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
