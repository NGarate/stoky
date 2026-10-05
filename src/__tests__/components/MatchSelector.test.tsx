import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import { minimumHeight } from "../setup/tailwind";

import { MatchSelector } from "@/components/receipt/MatchSelector";

/**
 * Which candidate is chosen, for someone not looking at the screen.
 *
 * The three candidates for a receipt line are mutually exclusive, and the
 * chosen one was marked by a tint and a tick. `lucide-react` gives an
 * unlabelled icon `aria-hidden`, so the tick was invisible to a screen reader
 * as well — the announced output for the selected candidate was byte-identical
 * to the ones beside it (WCAG 4.1.2). Tab through three, pick one, and there
 * was no way to tell which before pressing "Confirmar".
 */

const CANDIDATES = [
  { productId: "p1", name: "Leche entera", similarity: 0.82 },
  { productId: "p2", name: "Leche desnatada", similarity: 0.61 },
  { productId: "p3", name: "Leche de avena", similarity: 0.44 },
];

afterEach(cleanup);

describe("MatchSelector's targets", () => {
  it("clears the 48px floor on every candidate", async () => {
    // Hand-styled at p-2 around 14px text, each candidate was about 36px
    // tall — the row a person taps to say which product a receipt line is.
    renderWithIntl(
      <MatchSelector autoMatch={null} candidates={CANDIDATES} onSelect={() => {}} selectedId="p2" />,
      { locale: "es" },
    );

    for (const name of [/Leche entera/, /Leche desnatada/, /Leche de avena/]) {
      const height = await minimumHeight(screen.getByRole("button", { name }).className);
      expect(height ?? 0).toBeGreaterThanOrEqual(48);
    }
  });
});

describe("what a candidate says", () => {
  it("names the product, not the matcher's score", () => {
    // "Leche entera 82 %" — a trigram similarity, read aloud as part of the
    // choice and tinted by thresholds nobody is told. It is the system's
    // confidence in its own guess (REDESIGN_PLAN §7 rule 2, no system
    // vocabulary), and the order of the list already says which it thinks
    // likeliest.
    renderWithIntl(
      <MatchSelector autoMatch={null} candidates={CANDIDATES} onSelect={() => {}} selectedId={null} />,
      { locale: "es" },
    );

    expect(
      screen.getAllByRole("button").map((button) => button.textContent?.trim()),
    ).toEqual(["Leche entera", "Leche desnatada", "Leche de avena"]);
    expect(screen.queryByText(/%/)).toBeAbsent();
  });
});

describe("MatchSelector", () => {
  it("says which candidate is chosen, and which are not", () => {
    renderWithIntl(
      <MatchSelector
        autoMatch={null}
        candidates={CANDIDATES}
        onSelect={() => {}}
        selectedId="p2"
      />,
      { locale: "es" },
    );

    const chosen = screen.getByRole("button", { name: /Leche desnatada/ });
    expect(chosen.getAttribute("aria-pressed")).toBe("true");

    for (const name of [/Leche entera/, /Leche de avena/]) {
      expect(
        screen.getByRole("button", { name }).getAttribute("aria-pressed"),
      ).toBe("false");
    }
  });

  it("states it on every candidate, so none is merely undeclared", () => {
    renderWithIntl(
      <MatchSelector
        autoMatch={null}
        candidates={CANDIDATES}
        onSelect={() => {}}
        selectedId={null}
      />,
      { locale: "es" },
    );

    // Absent is not the same as false: a button with no `aria-pressed` is not
    // a toggle at all, and a screen reader says nothing about its state.
    for (const candidate of CANDIDATES) {
      expect(
        screen
          .getByRole("button", { name: new RegExp(candidate.name) })
          .getAttribute("aria-pressed"),
      ).toBe("false");
    }
  });

  it("still chooses when pressed", async () => {
    const onSelect = mock((_id: string) => {});
    renderWithIntl(
      <MatchSelector
        autoMatch={null}
        candidates={CANDIDATES}
        onSelect={onSelect}
        selectedId={null}
      />,
      { locale: "es" },
    );

    await userEvent.click(screen.getByRole("button", { name: /Leche entera/ }));

    expect(onSelect).toHaveBeenCalledWith("p1");
  });
});
