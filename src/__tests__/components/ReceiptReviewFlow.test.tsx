import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * Finishing a review must leave you where the next step is.
 *
 * `confirmAll` sets the receipt to CONFIRMED; only `applyReceipt` sets
 * APPLIED. Navigating to /applied on confirmation therefore landed on the one
 * page whose first job is to refuse to say "applied" over a receipt that is
 * not — so the ordinary outcome of the review journey was a screen reading
 * "todavía no se ha aplicado", with the button that would apply it back on
 * the page just left.
 */
const pushes: string[] = [];
const invalidated: string[] = [];
const confirmAllCalls: unknown[] = [];

/** When true, every mutation reports a failure instead of succeeding. */
let failing = false;

interface Callbacks {
  onSuccess?: () => void | Promise<void>;
  onError?: () => void;
}

const receipt = {
  id: "r1",
  status: "REVIEWING",
  createdAt: new Date("2026-08-01T10:00:00.000Z"),
  totalAmount: 12.5,
  store: { id: "st1", name: "Mercadona" },
  items: [
    {
      id: "i1",
      rawText: "LECHE ENTERA 1,19",
      parsedName: "Leche entera",
      quantity: 1,
      unitPrice: 1.19,
      totalPrice: 1.19,
      // `isItemReviewed` reads matchStatus, not a boolean — the page counts
      // pending items by that rule, and the button is disabled while any
      // remain.
      matchStatus: "USER_CONFIRMED",
      productId: "p1",
      matchedProductId: "p1",
      product: { id: "p1", name: "Leche entera", defaultUnit: "L" },
      matchConfidence: 0.9,
    },
  ],
};

mock.module("next/navigation", () => ({
  useParams: () => ({ id: "r1" }),
  useRouter: () => ({ push: (href: string) => pushes.push(href), replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/receipts/r1/review",
  redirect: () => {},
}));

// The real snackbar, not a stub of it.
//
// `mock.module` replaces a module for the whole bun process, so a stub here
// also replaces the component `Snackbar.test.tsx` renders — which turned that
// suite red the moment this file was added, depending on nothing but the
// order bun happened to load them in. Rendering the real provider is both
// immune to that and a stronger assertion: it proves the sentence reaches the
// screen rather than that a function was called.
mock.module("@/components/offline/queue-context", () => ({
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

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      receipt: {
        getReceiptWithItems: {
          invalidate: async () => void invalidated.push("getReceiptWithItems"),
        },
      },
    }),
    receipt: {
      getReceiptWithItems: {
        useQuery: () => ({ data: receipt, isLoading: false }),
      },
      confirmAll: {
        useMutation: (opts?: Callbacks) => ({
          mutate: (input: unknown) => {
            confirmAllCalls.push(input);
            if (failing) {
              opts?.onError?.();
              return;
            }
            void opts?.onSuccess?.();
          },
          mutateAsync: async () => {},
          isPending: false,
        }),
      },
      confirmItem: {
        useMutation: (opts?: Callbacks) => ({
          mutate: () => {
            if (failing) {
              opts?.onError?.();
              return;
            }
            void opts?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      applyReceipt: {
        useMutation: (opts?: Callbacks) => ({
          mutate: () => {
            if (failing) {
              opts?.onError?.();
              return;
            }
            void opts?.onSuccess?.();
          },
          mutateAsync: async () => {},
          isPending: false,
        }),
      },
    },
  },
}));

const { SnackbarProvider } = await import("@/components/ui/snackbar");
const ReviewPage = (await import("@/app/(dashboard)/receipts/[id]/review/page")).default;

const render = () =>
  renderWithIntl(
    <SnackbarProvider>
      <ReviewPage />
    </SnackbarProvider>,
    { locale: "es" },
  );

beforeEach(() => {
  pushes.length = 0;
  invalidated.length = 0;
  confirmAllCalls.length = 0;
  failing = false;
});

afterEach(cleanup);

describe("finishing a receipt review", () => {
  it("stays on the review, because applying happens here", async () => {
    render();

    await userEvent.click(
      screen.getByRole("button", { name: "Terminar revisión" }),
    );

    expect(confirmAllCalls).toHaveLength(1);
    // /applied would say the receipt has not been applied — true, and useless.
    expect(pushes).toEqual([]);
  });

  it("refetches, so the lines show as confirmed without a reload", async () => {
    render();

    await userEvent.click(
      screen.getByRole("button", { name: "Terminar revisión" }),
    );

    expect(invalidated).toContain("getReceiptWithItems");
  });

  it("says what happened, and what is now possible", async () => {
    render();

    await userEvent.click(
      screen.getByRole("button", { name: "Terminar revisión" }),
    );

    // The page's own live region already says "Todo revisado", which is the
    // state. This says what the state now makes possible, which nothing else
    // on the screen does — the button quietly becoming "Aplicar al
    // inventario" is the only other sign.
    expect(
      await screen.findAllByText(/Ya puedes aplicarlo al inventario/),
    ).not.toHaveLength(0);
  });
});

describe("when it does not work", () => {
  it("says a refused review failed, rather than nothing at all", async () => {
    failing = true;
    render();

    await userEvent.click(
      screen.getByRole("button", { name: "Terminar revisión" }),
    );

    // There was no error path at all. The button re-enabled, the pending
    // count did not move, no text was written anywhere in the document, and
    // `mutateAsync` rejected into an unhandled promise rejection — so a
    // screen-reader user was told nothing had happened and a sighted one
    // reasonably pressed it again (WCAG 3.3.1).
    expect(
      await screen.findAllByText(/No se ha podido terminar la revisión/),
    ).not.toHaveLength(0);
  });

  it("does not claim the review finished when it did not", async () => {
    failing = true;
    render();

    await userEvent.click(
      screen.getByRole("button", { name: "Terminar revisión" }),
    );

    expect(screen.queryByText(/Ya puedes aplicarlo al inventario/)).toBeAbsent();
  });
});
