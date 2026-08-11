import "../setup/matchers";
import { describe, it, expect, afterEach } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import { ProductRating } from "@/components/products/ProductRating";

/**
 * The rating on screen — Phase 6's display half.
 *
 * The formula's correctness lives in `rating.test.ts`; what is asserted here is
 * §6's interface contract. The word leads and is text, not colour. The
 * breakdown is reachable and says what lowered the score. The two honest
 * states are sentences a person can act on. And the Open Food Facts
 * attribution is present in every state, because ODbL requires it and because
 * the no-data state's "add its details" link is the same door.
 */

const NUTELLA = {
  nutriscore_grade: "e",
  additives_n: 2,
  additives_tags: ["en:e322", "en:e322i"],
  labels_tags: [],
};

afterEach(cleanup);

describe("a rated product", () => {
  it("leads with the word, in the reader's language", () => {
    renderWithIntl(<ProductRating barcode="301762" snapshot={NUTELLA} />);

    // 25/100 — the plan's own worked example.
    expect(screen.getByText("Mediocre")).toBeInTheDocument();
    expect(screen.getByText("25 de 100")).toBeInTheDocument();
  });

  it("says it in English too", () => {
    renderWithIntl(<ProductRating barcode="301762" snapshot={NUTELLA} />, {
      locale: "en",
    });

    expect(screen.getByText("Poor")).toBeInTheDocument();
    expect(screen.getByText("25 of 100")).toBeInTheDocument();
  });

  it("shows what lowered it, behind one tap", async () => {
    renderWithIntl(<ProductRating barcode="301762" snapshot={NUTELLA} />);

    await userEvent.click(screen.getByText("Ver por qué"));

    // The grade that cost 60 points, each additive with its class in words,
    // and the certification that was not there.
    expect(screen.getByText(/Nutri-Score E/)).toBeInTheDocument();
    expect(screen.getByText(/E322 · sin riesgo conocido/)).toBeInTheDocument();
    expect(screen.getByText("Sin certificado ecológico — 0 de 10 puntos")).toBeInTheDocument();
  });

  it("distinguishes a stated zero additives from missing data, in words", async () => {
    renderWithIntl(
      <ProductRating
        barcode="301762"
        snapshot={{ nutriscore_grade: "a", additives_n: 0 }}
      />,
    );
    await userEvent.click(screen.getByText("Ver por qué"));

    expect(screen.getByText(/Sin aditivos declarados/)).toBeInTheDocument();
  });
});

describe("the honest states", () => {
  it("says there is no data, and where to add it", () => {
    renderWithIntl(<ProductRating barcode="8480000123456" snapshot={null} />);

    expect(
      screen.getByText(/No tenemos información suficiente/),
    ).toBeInTheDocument();
    // The contribute link points at this product's own OFF page.
    expect(
      screen.getByRole("link", { name: /Añade sus datos/ }),
    ).toHaveAttribute(
      "href",
      "https://world.openfoodfacts.org/product/8480000123456",
    );
    // And no number appears anywhere: an invented score is the one lie this
    // feature must never tell.
    expect(screen.queryByText(/de 100/)).toBeNull();
  });

  it("says non-food is not rated, rather than scoring it low", () => {
    renderWithIntl(
      <ProductRating
        barcode="301762"
        snapshot={{ nutriscore_grade: "not-applicable" }}
      />,
    );

    expect(screen.getByText(/no es un alimento/)).toBeInTheDocument();
    expect(screen.queryByText(/de 100/)).toBeNull();
  });
});

describe("the licence", () => {
  it("credits Open Food Facts in every state", () => {
    // ODbL. The attribution is part of the work, not a nicety (§6).
    for (const snapshot of [NUTELLA, null, { nutriscore_grade: "not-applicable" }]) {
      const { unmount } = renderWithIntl(
        <ProductRating barcode="301762" snapshot={snapshot} />,
      );

      expect(
        screen.getByRole("link", { name: /Open Food Facts, licencia ODbL/ }),
      ).toBeInTheDocument();
      unmount();
    }
  });
});
