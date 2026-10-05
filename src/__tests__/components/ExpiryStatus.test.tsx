import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "../utils/render";
import {
  ExpiryRow,
  ExpiryStatus,
  expiryTone,
} from "@/components/inventory/ExpiryStatus";

/**
 * One answer to "when does it go off".
 *
 * Four screens gave four: "En 2 días" in a danger pill on the Panel, "Quedan
 * 2 días" on a warn card in the kitchen, "Quedan 4 días" as plain grey text a
 * column over, "Hace 3 días" in the inventory's block, and a bare red
 * "Caducado" span on the product page. And "Caducó hace 1 días", which the
 * Panel printed because its message had no plural.
 */
afterEach(cleanup);

describe("expiryTone", () => {
  it("is wrong once the date has passed, needs attention within three days, and is information after", () => {
    expect(expiryTone(-1)).toBe("danger");
    expect(expiryTone(-30)).toBe("danger");
    // Today is not expired: the date is the last good day.
    expect(expiryTone(0)).toBe("warn");
    expect(expiryTone(3)).toBe("warn");
    expect(expiryTone(4)).toBe("neutral");
  });
});

describe("ExpiryStatus", () => {
  it.each([
    [0, "Caduca hoy"],
    [1, "Caduca mañana"],
    [2, "Caduca en 2 días"],
    [-1, "Caducó ayer"],
    [-2, "Caducó hace 2 días"],
  ])("says %i days in one vocabulary: %s", (days, words) => {
    renderWithIntl(<ExpiryStatus daysUntilExpiry={days} />, { locale: "es" });
    expect(screen.getByText(words)).toBeInTheDocument();
  });

  it("never says 'hace 1 días'", () => {
    renderWithIntl(<ExpiryStatus daysUntilExpiry={-1} />, { locale: "es" });
    expect(screen.queryByText(/1 días/)).toBeAbsent();
  });

  it("speaks English from the same rule", () => {
    renderWithIntl(<ExpiryStatus daysUntilExpiry={-1} />, { locale: "en" });
    expect(screen.getByText("Expired yesterday")).toBeInTheDocument();
    cleanup();
    renderWithIntl(<ExpiryStatus daysUntilExpiry={5} />, { locale: "en" });
    expect(screen.getByText("Expires in 5 days")).toBeInTheDocument();
  });

  it("is a pill in the tone the rule gives", () => {
    renderWithIntl(<ExpiryStatus daysUntilExpiry={-2} />, { locale: "es" });
    expect(screen.getByText("Caducó hace 2 días").className).toContain("bg-danger");
    cleanup();
    renderWithIntl(<ExpiryStatus daysUntilExpiry={2} />, { locale: "es" });
    expect(screen.getByText("Caduca en 2 días").className).toContain("bg-warn");
    cleanup();
    renderWithIntl(<ExpiryStatus daysUntilExpiry={6} />, { locale: "es" });
    expect(screen.getByText("Caduca en 6 días").className).toContain("bg-muted");
  });

  it("outlines itself on a card already tinted its tone", () => {
    renderWithIntl(<ExpiryStatus daysUntilExpiry={2} onTintedRow />, {
      locale: "es",
    });
    const pill = screen.getByText("Caduca en 2 días");
    expect(pill.className).toContain("border-warn-foreground");
    expect(pill.className).not.toContain("bg-warn");
  });
});

describe("ExpiryRow", () => {
  it("says an unknown quantity without a unit hanging off it", () => {
    renderWithIntl(
      <ul>
        <ExpiryRow
          batch={{
            product: { id: "p1", name: "Leche" },
            location: null,
            quantity: null,
            unit: "L",
          }}
          daysUntilExpiry={1}
        />
      </ul>,
      { locale: "es" },
    );

    // It used to interpolate the fallback into "{quantity} {unit}", which
    // read "Cantidad sin confirmar L".
    expect(screen.getByText("Cantidad sin confirmar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Leche" })).toHaveAttribute(
      "href",
      "/products/p1",
    );
    expect(screen.getByText("Caduca mañana")).toBeInTheDocument();
  });
});
