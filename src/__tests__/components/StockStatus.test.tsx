import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";
import {
  StockAmount,
  StockStatus,
  stockTone,
} from "@/components/inventory/StockStatus";

/**
 * ISSUES UI-11, pinned.
 *
 * A product at zero with a minimum set is both out of stock and below its
 * minimum. Whichever question the code asks first decides the word, and the
 * screens asked in opposite orders: the seeded Café molido natural, at 0 of a
 * minimum of 2, wore "Stock bajo" on /inventory and "Sin stock" on the Panel.
 *
 * These assertions exist so that the precedence is a decision rather than an
 * accident of `if` order, and so that the next screen to adopt these atoms
 * inherits it instead of choosing again.
 */
afterEach(cleanup);

describe("StockStatus", () => {
  it("says run out, not low, when a product with a minimum is at zero", () => {
    renderWithIntl(<StockStatus isLowStock={true} totalStock={0} />, {
      locale: "es",
    });

    // Both are true of this product. Run out is the stronger statement.
    expect(screen.getByText("Sin stock")).toBeInTheDocument();
    expect(screen.queryByText("Stock bajo")).toBeAbsent();
  });

  it("says run out for a product with no minimum at all", () => {
    renderWithIntl(<StockStatus isLowStock={false} totalStock={0} />, {
      locale: "es",
    });

    expect(screen.getByText("Sin stock")).toBeInTheDocument();
  });

  it("says low while there is still something on the shelf", () => {
    renderWithIntl(<StockStatus isLowStock={true} totalStock={1} />, {
      locale: "es",
    });

    expect(screen.getByText("Stock bajo")).toBeInTheDocument();
  });

  it("says nothing is wrong when nothing is", () => {
    renderWithIntl(<StockStatus isLowStock={false} totalStock={5} />, {
      locale: "es",
    });

    expect(screen.getByText("Correcto")).toBeInTheDocument();
  });
});

describe("StockAmount", () => {
  it("tints by the same precedence the words use", () => {
    renderWithIntl(
      <StockAmount defaultUnit="paquete" isLowStock={true} totalStock={0} />,
      { locale: "es" },
    );

    // The number and the badge beside it must agree: danger, not warn.
    expect(screen.getByText("0 paquete").className).toContain(
      "text-danger-foreground",
    );
  });

  it("gives the row the same answer it gives the badge", () => {
    // The inventory tinted its rows by `isLowStock` alone while the badge
    // asked `totalStock <= 0` first. So a product at 0 of a minimum of 2 sat
    // in a **warn** row under a **danger** badge, and one at 0 with no
    // minimum had no tint at all under a danger badge — the state where the
    // tint matters most was the one it did not draw.
    expect(stockTone(0, true)).toBe("danger");
    expect(stockTone(0, false)).toBe("danger");
    expect(stockTone(1, true)).toBe("warn");
    expect(stockTone(5, false)).toBe("neutral");
  });

  it("always carries the unit, because a bare number is not an amount", () => {
    renderWithIntl(
      <StockAmount defaultUnit="kg" isLowStock={false} totalStock={5} />,
      { locale: "es" },
    );

    expect(screen.getByText("5 kg")).toBeInTheDocument();
  });
});
