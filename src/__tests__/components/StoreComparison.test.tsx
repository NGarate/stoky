import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * "Where is this cheapest" answered once, with the answer emphasised.
 *
 * It used to be answered three times — a tile row, a card list, and a table
 * of the same stores again — and emphasised in none of them.
 */
let prices: unknown[] = [];

mock.module("@/lib/trpc/client", () => ({
  api: {
    price: {
      getLatestPrices: {
        useQuery: () => ({ data: prices, isLoading: false }),
      },
    },
  },
}));

const { StoreComparison } = await import("@/components/price/StoreComparison");

const row = (id: string, store: string, price: number) => ({
  id,
  price,
  currency: "EUR",
  recordedAt: new Date("2026-08-01T10:00:00.000Z"),
  store: { id: `st-${id}`, name: store },
});

afterEach(cleanup);

describe("StoreComparison", () => {
  it("says so when there is nothing to compare", () => {
    prices = [];
    renderWithIntl(<StoreComparison productId="p1" />, { locale: "es" });

    expect(screen.getByText("No hay precios registrados")).toBeInTheDocument();
  });

  it("puts the cheapest first, whatever order the server sent", () => {
    prices = [row("a", "Carrefour", 1.45), row("b", "Mercadona", 1.19)];
    renderWithIntl(<StoreComparison productId="p1" />, { locale: "es" });

    const stores = screen.getAllByRole("listitem").map((n) => n.textContent);
    expect(stores[0]).toContain("Mercadona");
    expect(stores[1]).toContain("Carrefour");
  });

  it("emphasises the cheapest and de-emphasises the rest", () => {
    prices = [row("a", "Carrefour", 1.45), row("b", "Mercadona", 1.19)];
    const { container } = renderWithIntl(<StoreComparison productId="p1" />, {
      locale: "es",
    });

    const fills = [...container.querySelectorAll("span > span[style]")];
    // The emphasis pattern: one accent, the rest grey. A hue per store would
    // spend the only free channel on identity the labels already carry.
    expect(fills[0]?.className).toContain("bg-chart-emphasis");
    expect(fills[1]?.className).toContain("bg-chart-muted");
  });

  it("never says it in colour alone", () => {
    prices = [row("a", "Carrefour", 1.45), row("b", "Mercadona", 1.19)];
    renderWithIntl(<StoreComparison productId="p1" />, { locale: "es" });

    const first = screen.getAllByRole("listitem")[0]!;
    expect(within(first).getByText("Mejor precio")).toBeInTheDocument();
  });

  it("writes every price as text, so the bars add nothing that is only a bar", () => {
    prices = [row("a", "Carrefour", 1.45), row("b", "Mercadona", 1.19)];
    renderWithIntl(<StoreComparison productId="p1" />, { locale: "es" });

    // There is no separate table view to build because the markup already is
    // one: a reader who cannot see a bar loses no value.
    expect(screen.getByText(/1,19/)).toBeInTheDocument();
    expect(screen.getByText(/1,45/)).toBeInTheDocument();
  });

  it("hides the bars from assistive technology, which would hear them twice", () => {
    prices = [row("a", "Carrefour", 1.45), row("b", "Mercadona", 1.19)];
    const { container } = renderWithIntl(<StoreComparison productId="p1" />, {
      locale: "es",
    });

    for (const track of container.querySelectorAll("span.rounded-full")) {
      const hidden =
        track.getAttribute("aria-hidden") === "true" ||
        track.closest('[aria-hidden="true"]') !== null;
      expect(hidden).toBe(true);
    }
  });

  it("scales from zero, so near-equal prices look near-equal", () => {
    prices = [row("a", "Carrefour", 1.0), row("b", "Mercadona", 0.5)];
    const { container } = renderWithIntl(<StoreComparison productId="p1" />, {
      locale: "es",
    });

    const fills = [...container.querySelectorAll("span > span[style]")];
    // Half the price, half the bar. A truncated axis would turn a 2% gap into
    // a story that is not in the data.
    expect((fills[0] as HTMLElement).style.width).toBe("50%");
    expect((fills[1] as HTMLElement).style.width).toBe("100%");
  });

  it("says how much dearer the others are, in words", () => {
    prices = [row("a", "Carrefour", 1.5), row("b", "Mercadona", 1.0)];
    renderWithIntl(<StoreComparison productId="p1" />, { locale: "es" });

    expect(screen.getByText(/50% más caro que el mejor/)).toBeInTheDocument();
  });
});
