"use client";

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
  const formatScore = (score: number) => {
    return `${Math.round(score * 100)}%`;
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.7) return "text-green-600";
    if (score >= 0.5) return "text-yellow-600";
    return "text-gray-500";
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-700">Coincidencias encontradas:</p>

      {autoMatch && (
        <div className="p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
          Mejor coincidencia automática: <strong>{autoMatch.name}</strong>
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
                ? "border-blue-500 bg-blue-50"
                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <div className="flex items-center gap-2">
              {selectedId === candidate.productId && (
                <Check className="w-4 h-4 text-blue-500" />
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
