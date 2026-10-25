import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";

/**
 * The best price is the best *unit* price. A record's `price` is the total
 * paid for `quantity` units, so ranking it named the single carton at 0,99 €
 * as best over six for 5,34 € — 0,89 € each.
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

const { BestPriceIndicator } =
  await import("@/components/price/BestPriceIndicator");

const row = (id: string, store: string, price: number, quantity = 1) => ({
  id,
  price,
  quantity,
  unit: "unidad",
  unitPrice: price / quantity,
  currency: "EUR",
  recordedAt: new Date("2026-08-01T10:00:00.000Z"),
  store: { id: `st-${id}`, name: store },
});

afterEach(cleanup);

describe("BestPriceIndicator", () => {
  it("names the store with the lowest unit price, at its unit price", () => {
    prices = [row("a", "Carrefour", 0.99), row("b", "Mercadona", 5.34, 6)];
    const { container } = renderWithIntl(
      <BestPriceIndicator productId="p1" />,
      {
        locale: "es",
      },
    );

    expect(screen.getByText("en Mercadona")).toBeInTheDocument();
    expect(container.textContent).toContain("0,89");
    expect(container.textContent).toContain("por unidad");
  });

  it("does not paint the best price in a state's colour", () => {
    prices = [row("a", "Carrefour", 0.99), row("b", "Mercadona", 5.34, 6)];
    const { container } = renderWithIntl(
      <BestPriceIndicator productId="p1" />,
      {
        locale: "es",
      },
    );

    // `ok` means "this is healthy", and CLAUDE.md names "best price" as the
    // example of something that is not a state. The price was `text-ok-
    // foreground`, spending the tone that has to keep meaning "fine".
    for (const node of container.querySelectorAll("*")) {
      expect(node.getAttribute("class") ?? "").not.toMatch(
        /\b(?:text|bg|border)-(?:ok|warn|danger)(?:-foreground)?\b/,
      );
    }
  });

  it("compares a current unit price against the best unit price", () => {
    prices = [row("a", "Carrefour", 0.99), row("b", "Mercadona", 5.34, 6)];
    renderWithIntl(
      <BestPriceIndicator
        currentPrice={0.99}
        currentStoreId="st-a"
        productId="p1"
      />,
      { locale: "es" },
    );

    // 0,99 against 0,89 is 11% over — not the best, and not within 10%.
    expect(screen.getByText("+11% más caro que el mejor")).toBeInTheDocument();
  });
});
