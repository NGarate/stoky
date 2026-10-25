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

const row = (id: string, store: string, price: number, quantity = 1) => ({
  id,
  price,
  quantity,
  unit: "unidad",
  // What `price.getLatestPrices` computes on the server.
  unitPrice: price / quantity,
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

  it("labels the best price as a neutral pill, not a state", () => {
    prices = [row("a", "Carrefour", 1.45), row("b", "Mercadona", 1.19)];
    renderWithIntl(<StoreComparison productId="p1" />, { locale: "es" });

    // It was `text-ok-foreground`: the healthy-state ink on a ranking.
    const label = screen.getByText("Mejor precio");
    expect(label.className).toContain("bg-muted");
    expect(label.className).not.toMatch(
      /\b(?:text|bg|border)-(?:ok|warn|danger)(?:-foreground)?\b/,
    );
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

  it("ranks by unit price, so six for 5,34 € beats one for 0,99 €", () => {
    // Ranked by the total paid, the single came first and the pack read as
    // 439% dearer.
    prices = [row("a", "Carrefour", 0.99), row("b", "Mercadona", 5.34, 6)];
    renderWithIntl(<StoreComparison productId="p1" />, { locale: "es" });

    const [first, second] = screen.getAllByRole("listitem");
    expect(first!.textContent).toContain("Mercadona");
    expect(within(first!).getByText("Mejor precio")).toBeInTheDocument();
    expect(first!.textContent).toContain("0,89");
    // The total is still there, said as a total.
    expect(first!.textContent).toContain("5,34");
    expect(first!.textContent).toContain("por 6 unidad");
    expect(second!.textContent).toContain("11% más caro que el mejor");
  });
});

describe("its place in the page outline", () => {
  it("is a section of the page, at the page's section level and size", () => {
    // It was an h3 at md:text-2xl straight after the chart's h2 at text-lg:
    // the outline said "part of the chart", the type said "bigger than it"
    // (WCAG 1.3.1).
    prices = [row("a", "Carrefour", 1.45), row("b", "Mercadona", 1.19)];
    const { container } = renderWithIntl(<StoreComparison productId="p1" />, {
      locale: "es",
    });

    const heading = container.querySelector("#store-comparison");
    expect(heading?.tagName).toBe("H2");
    expect(heading?.className).not.toContain("md:text-2xl");
  });
});
