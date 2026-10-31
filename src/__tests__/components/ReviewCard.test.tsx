import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import { Decimal } from "@prisma/client-runtime-utils";

// The scan dialog's lookup, for the one case that opens it. Complete, with
// the provider, per D50.
mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      product: {
        invalidate: async () => {},
        getByBarcode: {
          fetch: async ({ barcode }: { barcode: string }) =>
            barcode === "8410000000123"
              ? {
                  id: "p9",
                  name: "Leche Granja",
                  brand: null,
                  defaultUnit: "L",
                }
              : null,
        },
      },
    }),
    product: {
      scanBarcode: { useMutation: () => ({ isPending: false, mutate() {} }) },
      create: { useMutation: () => ({ isPending: false, mutate() {} }) },
    },
  },
  TRPCProvider: ({ children }: { children: unknown }) => children,
}));
mock.module("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints() {
      return new Promise(() => {});
    }
  },
}));

const { ReviewCard } = await import("@/components/receipt/ReviewCard");

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
  parsedPrice: new Decimal(1.19),
  parsedQuantity: new Decimal(1),
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

describe("scanning the packet for a line", () => {
  it("chooses the product its code belongs to, ready to confirm", async () => {
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    const confirmed: unknown[][] = [];
    renderWithIntl(
      <ReviewCard
        item={line({ matchedProductId: null, matchedProduct: null })}
        onConfirm={(...args) => confirmed.push(args)}
      />,
      { locale: "es" },
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Escanear el producto de «Leche entera»",
      }),
    );
    const dialog = screen.getByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("¿No lo lee? Escribe el código"),
      "8410000000123",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Buscar" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Leche Granja" }),
      ).toHaveAttribute("aria-pressed", "true");
    });
    await userEvent.click(screen.getByRole("button", { name: /Confirmar/ }));
    expect(confirmed).toEqual([["MATCH", "p9"]]);
  });
});
