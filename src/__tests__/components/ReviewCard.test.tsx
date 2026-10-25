import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";
import { ReviewCard } from "@/components/receipt/ReviewCard";

/**
 * One receipt line under review.
 *
 * Its status was an icon plus coloured text rather than a `Badge`, and
 * "Auto-detectado" was carried by a shopping-cart glyph — the shopping
 * screen's own navigation icon — and a `bg-muted` tint on the whole card. A
 * match the matcher made is not a state; it is a fact about where the
 * suggestion came from.
 */
afterEach(cleanup);

const line = (overrides: Record<string, unknown> = {}) => ({
  id: "i1",
  rawText: "LECHE ENTERA 1L",
  parsedName: "Leche entera",
  parsedPrice: 1.19,
  parsedQuantity: 1,
  matchedProductId: "p1",
  matchStatus: "PENDING",
  matchConfidence: null,
  matchedProduct: { id: "p1", name: "Leche entera" },
  candidates: [],
  ...overrides,
});

describe("leaving a line out", () => {
  it("is a worded button named for its line, not an X", () => {
    const skipped: string[] = [];
    renderWithIntl(
      <ReviewCard item={line()} onConfirm={(action) => skipped.push(action)} />,
      { locale: "es" },
    );

    const skip = screen.getByRole("button", {
      name: "No añadir esta línea: «Leche entera»",
    });
    expect(skip.textContent).toBe("No añadir esta línea");
    expect(skip.querySelector("svg")).toBeNull();
    skip.click();
    expect(skipped).toEqual(["SKIP"]);
  });
});

describe("ReviewCard status", () => {
  it("says an automatic match in a neutral pill, without a glyph or a tint", () => {
    const { container } = renderWithIntl(
      <ReviewCard
        item={line({ matchStatus: "AUTO_MATCHED", matchConfidence: 0.9 })}
        onConfirm={() => {}}
      />,
      { locale: "es" },
    );

    const pill = screen.getByText("Reconocido automáticamente");
    expect(pill.className).toContain("bg-muted");
    expect(pill.querySelector("svg")).toBeNull();
    expect(pill.parentElement?.querySelector("svg")).toBeNull();
    // The card is not tinted for it.
    expect(
      (container.firstElementChild as HTMLElement).className,
    ).not.toContain("bg-muted");
  });

  it("says a confirmed line in an ok pill, outlined on its ok card", () => {
    renderWithIntl(
      <ReviewCard
        item={line({ matchStatus: "USER_CONFIRMED" })}
        onConfirm={() => {}}
      />,
      { locale: "es" },
    );

    const pill = screen.getByText("Confirmado");
    expect(pill.className).toContain("border-ok-foreground");
    expect(pill.className).not.toContain("bg-ok");
  });

  it("does not call a line left out 'confirmed', or colour it healthy", () => {
    const { container } = renderWithIntl(
      <ReviewCard
        item={line({ matchStatus: "SKIPPED" })}
        onConfirm={() => {}}
      />,
      { locale: "es" },
    );

    expect(screen.queryByText("Confirmado")).toBeAbsent();
    expect(screen.getByText("No se añadirá").className).toContain("bg-muted");
    expect(
      (container.firstElementChild as HTMLElement).className,
    ).not.toContain("bg-ok");
  });
});
