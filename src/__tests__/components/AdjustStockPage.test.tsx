import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";
import { Decimal } from "@prisma/client-runtime-utils";

/**
 * `/products/[id]/adjust` — Phase 8 item 5.
 *
 * The person types the *total they can count*, not the difference; the delta
 * is this page's arithmetic and the thing pinned here. Sign errors in stock
 * corrections are exactly how UI-3's `Math.abs` laundering survived, so the
 * payload is asserted signed, both directions.
 */
let adjustCalls: Array<Record<string, unknown>>;
let replaced: string[] = [];

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: (href: string) => replaced.push(href),
    refresh: () => {},
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/products/p1/adjust",
  useParams: () => ({ id: "p1" }),
  redirect: () => {},
}));

// The real snackbar rather than a stub: `mock.module` replaces a module for
// the whole bun process, so stubbing it would reach every suite that renders
// the real provider.
mock.module("@/lib/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending: [], failed: [], status: "idle", full: false },
    enqueue: () => ({ ok: true, id: "op" }),
    drain: () => {},
    cancel: () => true,
    holdRemainingMs: () => 0,
    retry: () => {},
    discard: () => {},
    flush: async () => {},
    purgeAll: () => {},
  }),
}));

const LOADED = {
  data: {
    id: "p1",
    name: "Huevos",
    totalStock: new Decimal(6),
    defaultUnit: "ud",
  } as unknown,
  isPending: false,
  error: null as { message: string } | null,
  refetch: () => {},
};
let productQuery = { ...LOADED };

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      invalidate: () => Promise.resolve(),
      product: { getById: { invalidate: () => Promise.resolve() } },
      inventory: { getStockOverview: { invalidate: () => Promise.resolve() } },
    }),
    product: {
      getById: {
        useQuery: () => productQuery,
      },
    },
    inventory: {
      adjustStock: {
        useMutation: (opts?: {
          onSuccess?: (e: unknown, v: unknown) => unknown;
        }) => ({
          mutate: (input: Record<string, unknown>) => {
            adjustCalls.push(input);
            void opts?.onSuccess?.({}, input);
          },
          isPending: false,
        }),
      },
    },
  },
}));

const { AdjustStockView } =
  await import("@/app/(dashboard)/products/[id]/adjust/page");
const { SnackbarProvider } = await import("@/components/ui/snackbar");

beforeEach(() => {
  adjustCalls = [];
  replaced = [];
  productQuery = { ...LOADED };
});

afterEach(cleanup);

function submit(actual: string, reason: string): void {
  fireEvent.change(screen.getByLabelText("Lo que hay en realidad"), {
    target: { value: actual },
  });
  fireEvent.change(screen.getByLabelText("Motivo"), {
    target: { value: reason },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar ajuste" }));
}

/** A refusal as the client receives it: the code is what RouteState reads. */
function notFoundError(): TRPCClientError<never> {
  const error = new TRPCClientError<never>("Product not found");
  Object.defineProperty(error, "data", {
    value: { code: "NOT_FOUND", httpStatus: 404 },
  });
  return error;
}

describe("the adjustment", () => {
  it("does not turn a blank recount into zero stock", () => {
    renderWithIntl(
      <SnackbarProvider>
        <AdjustStockView id="p1" />
      </SnackbarProvider>,
      { locale: "es" },
    );
    submit("", "Recuento");
    expect(adjustCalls).toEqual([]);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("computes a signed delta downwards from the counted total", () => {
    renderWithIntl(
      <SnackbarProvider>
        <AdjustStockView id="p1" />
      </SnackbarProvider>,
      { locale: "es" },
    );

    submit("4", "Se rompieron dos");

    expect(adjustCalls).toEqual([
      {
        productId: "p1",
        quantity: -2,
        expectedStock: 6,
        unit: "ud",
        reason: "Se rompieron dos",
      },
    ]);
  });

  /**
   * A saved adjustment used to leave the person on a form still holding what
   * they had typed — so the screen after "Guardar ajuste" looked exactly like
   * the screen before it, with a second press one tap away. It now goes back
   * to the product, which is where the new number is, and says so there.
   */
  it("returns to the product once saved, and says what the stock is now", async () => {
    renderWithIntl(
      <SnackbarProvider>
        <AdjustStockView id="p1" />
      </SnackbarProvider>,
      { locale: "es" },
    );

    submit("4", "Se rompieron dos");

    expect(replaced).toEqual(["/products/p1"]);
    expect(
      await screen.findByText("Ajustado. «Huevos» queda en 4 unidades."),
    ).toBeInTheDocument();
  });

  it("computes it upwards too — the sign is the point", () => {
    renderWithIntl(
      <SnackbarProvider>
        <AdjustStockView id="p1" />
      </SnackbarProvider>,
      { locale: "es" },
    );

    submit("9", "Recuento de despensa");

    expect(adjustCalls[0]?.quantity).toBe(3);
  });

  it("refuses a no-op and an unexplained adjustment", () => {
    renderWithIntl(
      <SnackbarProvider>
        <AdjustStockView id="p1" />
      </SnackbarProvider>,
      { locale: "es" },
    );

    submit("6", "  ");

    expect(adjustCalls).toEqual([]);
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain("Ya coincide");
    expect(alert).toContain("motivo del ajuste");
  });

  /**
   * Two controls point at the product, and they are two different jobs.
   *
   * The one at the top is the way out of the screen: a `BackLink`, carrying
   * the arrow every other way back carries. The one in the form's action row
   * is the form's escape — it sits beside the submit, it wears a button, and
   * it says "Cancelar".
   *
   * They used to say the same words and go to the same place, which meant a
   * screen reader announced two identical links and neither said which was
   * which (WCAG 2.4.9). `Button asChild` renders an anchor, so they were both
   * links; the fix is the wording, not the element.
   */
  it("leaves by a back link and cancels by a differently-named one", () => {
    renderWithIntl(
      <SnackbarProvider>
        <AdjustStockView id="p1" />
      </SnackbarProvider>,
      { locale: "es" },
    );

    const back = screen.getByRole("link", { name: "Volver al producto" });
    expect(back).toHaveAttribute("href", "/products/p1");
    expect(back.querySelectorAll("svg").length).toBe(1);
    expect(back.textContent).toBe("Volver al producto");

    // The form's escape: same destination, its own name, no arrow.
    const cancel = screen.getByRole("link", { name: "Cancelar" });
    expect(cancel).toHaveAttribute("href", "/products/p1");
    expect(cancel.querySelectorAll("svg").length).toBe(0);
  });

  it("says where it goes when the product could not load (WCAG 2.4.9)", () => {
    // It said "Volver al producto" and went to /products — the list, not
    // the product. After a failure the product is still the way back.
    productQuery = { ...LOADED, data: undefined, error: { message: "boom" } };
    renderWithIntl(
      <SnackbarProvider>
        <AdjustStockView id="p1" />
      </SnackbarProvider>,
      { locale: "es" },
    );

    expect(
      screen.getByRole("link", { name: "Volver al producto" }),
    ).toHaveAttribute("href", "/products/p1");
  });

  it("goes to the products when there is no product to go back to", () => {
    productQuery = {
      ...LOADED,
      data: undefined,
      error: notFoundError(),
    };
    renderWithIntl(
      <SnackbarProvider>
        <AdjustStockView id="p1" />
      </SnackbarProvider>,
      { locale: "es" },
    );

    expect(
      screen.getByRole("link", { name: "Volver a productos" }),
    ).toHaveAttribute("href", "/products");
  });
});
