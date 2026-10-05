import { describe, it, expect } from "bun:test";
import { matchScore, tokenSimilarity } from "@/server/services/productMatcher";

describe("tokenSimilarity", () => {
  it("scores shared words over both names, not the shorter one", () => {
    // Divided by the smaller name, one shared word out of one scored 1.0.
    expect(tokenSimilarity("Leche", "LECHE DE COCO")).toBeCloseTo(2 / 3);
    expect(tokenSimilarity("Pan", "Pan de molde")).toBeCloseTo(2 / 3);
  });

  it("ignores words that only join a name together", () => {
    expect(tokenSimilarity("aceite de oliva", "aceite oliva")).toBe(1);
    expect(tokenSimilarity("pan con tomate", "pan de tomate")).toBe(1);
  });

  it("folds case and accents", () => {
    expect(tokenSimilarity("Café Descafeinado", "CAFE DESCAFEINADO")).toBe(1);
  });

  it("is zero for names with nothing in common, or nothing at all", () => {
    expect(tokenSimilarity("yogur natural", "leche desnatada")).toBe(0);
    expect(tokenSimilarity("de la", "leche")).toBe(0);
  });
});

describe("matchScore", () => {
  it("lets trigram similarity alone reach the auto-match threshold", () => {
    expect(matchScore(0.85, 0)).toBe(0.85);
  });

  it("never lets containment alone reach it", () => {
    expect(matchScore(0.43, 1)).toBeLessThan(0.7);
    expect(matchScore(0.43, 1)).toBeGreaterThanOrEqual(0.3);
  });

  it("uses containment to rank a weak trigram score as a candidate", () => {
    expect(matchScore(0.2, 0.5)).toBe(0.5);
  });
});
