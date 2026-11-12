import "../setup/matchers";
import { describe, it, expect, afterEach, mock } from "bun:test";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import { Decimal } from "@prisma/client-runtime-utils";

/** What `readRegion` was asked, and what it answers. */
const framed: unknown[] = [];
let framedLine: unknown = null;

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
    receipt: {
      getImage: {
        useQuery: () => ({ data: "data:image/jpeg;base64,c3RvcmVk" }),
      },
      readRegion: {
        useMutation: (options: {
          onSuccess: (answer: { line: unknown }) => void;
        }) => ({
          isPending: false,
          mutate: (input: unknown) => {
            framed.push(input);
            options.onSuccess({ line: framedLine });
          },
        }),
      },
    },
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
      <ReviewCard
        receiptId="r1"
        ticketQuad={null}
        onRemove={() => {}}
        item={line()}
        onConfirm={(action) => skipped.push(action)}
        onCorrect={() => {}}
      />,
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

describe("correcting what OCR read", () => {
  it("opens the line as it was read and sends it back corrected", async () => {
    const corrected: unknown[] = [];
    renderWithIntl(
      <ReviewCard
        receiptId="r1"
        ticketQuad={null}
        onRemove={() => {}}
        item={line({ parsedQuantity: new Decimal(2) })}
        onConfirm={() => {}}
        onCorrect={(fixed) => corrected.push(fixed)}
      />,
      { locale: "es" },
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Corregir la línea «Leche entera»",
      }),
    );
    const name = screen.getByLabelText("Producto");
    const price = screen.getByLabelText("Importe");
    expect((name as HTMLInputElement).value).toBe("Leche entera");
    expect((price as HTMLInputElement).value).toBe("1.19");
    expect((screen.getByLabelText("Cantidad") as HTMLInputElement).value).toBe(
      "2",
    );

    await userEvent.clear(name);
    await userEvent.type(name, "Leche semidesnatada");
    await userEvent.clear(price);
    await userEvent.type(price, "2.38");
    await userEvent.click(
      screen.getByRole("button", { name: "Guardar corrección" }),
    );

    expect(corrected).toEqual([
      { name: "Leche semidesnatada", price: 2.38, quantity: 2 },
    ]);
    // Closed again, showing the line rather than the form.
    expect(screen.queryByLabelText("Producto")).toBeAbsent();
  });

  it("sends an emptied price as no price, and nothing at all for no quantity", async () => {
    const corrected: unknown[] = [];
    renderWithIntl(
      <ReviewCard
        receiptId="r1"
        ticketQuad={null}
        onRemove={() => {}}
        item={line()}
        onConfirm={() => {}}
        onCorrect={(fixed) => corrected.push(fixed)}
      />,
      { locale: "es" },
    );

    await userEvent.click(
      screen.getByRole("button", { name: /^Corregir la línea/ }),
    );
    await userEvent.clear(screen.getByLabelText("Importe"));
    await userEvent.clear(screen.getByLabelText("Cantidad"));
    const save = screen.getByRole("button", { name: "Guardar corrección" });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Cantidad"), "1");
    await userEvent.click(save);
    expect(corrected).toEqual([{ name: "Leche entera", quantity: 1 }]);
  });

  it("is offered on a line already confirmed: a right product at a wrong price", () => {
    renderWithIntl(
      <ReviewCard
        receiptId="r1"
        ticketQuad={null}
        onRemove={() => {}}
        item={line({ matchStatus: "USER_CONFIRMED" })}
        onConfirm={() => {}}
        onCorrect={() => {}}
      />,
      { locale: "es" },
    );

    expect(
      screen.getByRole("button", { name: /^Corregir la línea/ }),
    ).toBeInTheDocument();
  });
});

describe("ReviewCard status", () => {
  it("says an automatic match in a neutral pill, without a glyph or a tint", () => {
    const { container } = renderWithIntl(
      <ReviewCard
        receiptId="r1"
        ticketQuad={null}
        onRemove={() => {}}
        item={line({ matchStatus: "AUTO_MATCHED", matchConfidence: 0.9 })}
        onConfirm={() => {}}
        onCorrect={() => {}}
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
        receiptId="r1"
        ticketQuad={null}
        onRemove={() => {}}
        item={line({ matchStatus: "USER_CONFIRMED" })}
        onConfirm={() => {}}
        onCorrect={() => {}}
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
        receiptId="r1"
        ticketQuad={null}
        onRemove={() => {}}
        item={line({ matchStatus: "SKIPPED" })}
        onConfirm={() => {}}
        onCorrect={() => {}}
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
        receiptId="r1"
        ticketQuad={null}
        onRemove={() => {}}
        item={line({ matchedProductId: null, matchedProduct: null })}
        onConfirm={(...args) => confirmed.push(args)}
        onCorrect={() => {}}
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

describe("correcting from the lines framed on the photo", () => {
  it("reads only the framed lines and starts the correction from them", async () => {
    framed.length = 0;
    framedLine = { name: "tenders pollo", price: 13.99, quantity: 1 };
    const corrected: unknown[] = [];
    renderWithIntl(
      <ReviewCard
        receiptId="r1"
        ticketQuad={null}
        onRemove={() => {}}
        item={line()}
        onConfirm={() => {}}
        onCorrect={(fixed) => corrected.push(fixed)}
      />,
      { locale: "es" },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Corregir la línea «Leche entera»" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Elegir las líneas en el ticket" }),
    );
    // The frame starts as a band across the middle of the photo.
    await userEvent.click(
      screen.getByRole("button", { name: "Leer estas líneas" }),
    );

    expect(framed).toEqual([
      {
        receiptId: "r1",
        quad: [
          [0, 0.46],
          [1, 0.46],
          [1, 0.54],
          [0, 0.54],
        ],
      },
    ]);
    expect((screen.getByLabelText("Producto") as HTMLInputElement).value).toBe(
      "tenders pollo",
    );
    expect((screen.getByLabelText("Importe") as HTMLInputElement).value).toBe(
      "13.99",
    );
    expect(screen.getByText(/Leído de nuevo/)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Guardar corrección" }),
    );
    expect(corrected).toEqual([
      { name: "tenders pollo", price: 13.99, quantity: 1 },
    ]);
  });

  it("frames the lines inside the ticket's part of the photo when it was framed", async () => {
    framed.length = 0;
    framedLine = null;
    renderWithIntl(
      <ReviewCard
        receiptId="r1"
        ticketQuad={[
          [0.3, 0.1],
          [0.6, 0.1],
          [0.6, 0.9],
          [0.3, 0.9],
        ]}
        onRemove={() => {}}
        item={line()}
        onConfirm={() => {}}
        onCorrect={() => {}}
      />,
      { locale: "es" },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Corregir la línea «Leche entera»" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Elegir las líneas en el ticket" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Leer estas líneas" }),
    );

    // A band across the middle of the ticket, in the photo's proportions.
    const { quad } = framed[0] as { quad: number[][] };
    expect(quad.map(([x]) => x)).toEqual([0.3, 0.6, 0.6, 0.3]);
    expect(quad[0]![1]).toBeCloseTo(0.1 + 0.8 * 0.46);
    expect(quad[2]![1]).toBeCloseTo(0.1 + 0.8 * 0.54);
  });

  it("says so when no article came of the framed lines, and keeps the frame", async () => {
    framedLine = null;
    renderWithIntl(
      <ReviewCard
        receiptId="r1"
        ticketQuad={null}
        onRemove={() => {}}
        item={line()}
        onConfirm={() => {}}
        onCorrect={() => {}}
      />,
      { locale: "es" },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Corregir la línea «Leche entera»" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Elegir las líneas en el ticket" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Leer estas líneas" }),
    );

    expect(
      screen.getByText(/No se ha leído ningún artículo/),
    ).toBeInTheDocument();
    expect(screen.getByAltText("Foto del ticket")).toBeInTheDocument();
  });

  it("moves a corner of the frame with the arrow keys", async () => {
    framed.length = 0;
    framedLine = null;
    renderWithIntl(
      <ReviewCard
        receiptId="r1"
        ticketQuad={null}
        onRemove={() => {}}
        item={line()}
        onConfirm={() => {}}
        onCorrect={() => {}}
      />,
      { locale: "es" },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Corregir la línea «Leche entera»" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Elegir las líneas en el ticket" }),
    );
    screen.getByRole("button", { name: "Esquina superior izquierda" }).focus();
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}{ArrowRight}");
    await userEvent.click(
      screen.getByRole("button", { name: "Leer estas líneas" }),
    );

    const [[x, y]] = (framed[0] as { quad: number[][] }).quad as [
      [number, number],
    ];
    expect(x).toBeCloseTo(0.01);
    expect(y).toBeCloseTo(0.41);
  });
});

describe("deleting a line that was never an article", () => {
  it("is offered while correcting, named for its line", async () => {
    let removed = 0;
    renderWithIntl(
      <ReviewCard
        receiptId="r1"
        ticketQuad={null}
        onRemove={() => removed++}
        item={line()}
        onConfirm={() => {}}
        onCorrect={() => {}}
      />,
      { locale: "es" },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Corregir la línea «Leche entera»" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Eliminar el artículo «Leche entera»",
      }),
    );

    expect(removed).toBe(1);
  });
});
