import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";
import { axeViolations } from "../utils/axe";
import es from "../../../messages/es.json";

/**
 * Finishing a review is one press, and it ends on the summary.
 *
 * `confirmAll` sets the receipt to CONFIRMED; only `applyReceipt` sets
 * APPLIED. The page used to make those two presses — "Terminar revisión",
 * then "Aplicar al inventario" — with a snackbar between them saying the
 * second was now possible. Once every line is reviewed the first decides
 * nothing a person can see, so the one button does both, in that order, and
 * the summary at /applied is where it lands.
 */ const pushes: string[] = [];
const invalidated: string[] = [];
const confirmAllCalls: unknown[] = [];
let applyCalls = 0;

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
  useRouter: () => ({
    push: (href: string) => pushes.push(href),
    replace: () => {},
    refresh: () => {},
  }),
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

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      receipt: {
        invalidate: async () => void invalidated.push("receipt"),
        getReceiptWithItems: {
          invalidate: async () => void invalidated.push("getReceiptWithItems"),
        },
      },
      inventory: { invalidate: async () => void invalidated.push("inventory") },
      product: { invalidate: async () => void invalidated.push("product") },
      shopping: { invalidate: async () => void invalidated.push("shopping") },
      price: { invalidate: async () => void invalidated.push("price") },
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
            applyCalls += 1;
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
const ReviewPage = (await import("@/app/(dashboard)/receipts/[id]/review/page"))
  .default;

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
  applyCalls = 0;
  failing = false;
});

afterEach(cleanup);

describe("finishing a receipt review", () => {
  it("adds it to the inventory with one press once every line is reviewed", async () => {
    // It took two: "Terminar revisión", a snackbar saying the receipt could
    // now be applied, and then "Aplicar al inventario" in the same place.
    // The first press decided nothing a person could see — every line was
    // already reviewed — so it was a step that only the state machine
    // needed. Now the one press does both, in order.
    render();

    await userEvent.click(
      screen.getByRole("button", { name: es.receipts.applyToInventory }),
    );

    expect(confirmAllCalls).toHaveLength(1);
    expect(applyCalls).toBe(1);
    expect(pushes).toEqual(["/receipts/r1/applied"]);
  });

  it("offers only that one button", () => {
    render();

    expect(
      screen.queryByRole("button", { name: "Terminar revisión" }),
    ).toBeAbsent();
  });

  it("refreshes stock, products, prices and the shopping list", async () => {
    // Applying moves stock and records prices, and nothing was refetched:
    // the inventory and the price history kept their pre-receipt answers.
    render();

    await userEvent.click(
      screen.getByRole("button", { name: es.receipts.applyToInventory }),
    );

    expect(invalidated).toEqual(
      expect.arrayContaining(["inventory", "product", "shopping", "price"]),
    );
  });

  it("offers nothing to press while a line still needs a decision", () => {
    // The line count says what is left; a finish button before then could
    // only be a disabled one, which a keyboard cannot reach to ask why.
    const items = receipt.items;
    receipt.items = [{ ...items[0]!, matchStatus: "NEEDS_REVIEW" }];
    try {
      render();

      expect(
        screen.queryByRole("button", { name: es.receipts.applyToInventory }),
      ).toBeAbsent();
    } finally {
      receipt.items = items;
    }
  });

  it("applies directly a receipt that is already confirmed", async () => {
    const status = receipt.status;
    receipt.status = "CONFIRMED";
    try {
      render();

      await userEvent.click(
        screen.getByRole("button", { name: es.receipts.applyToInventory }),
      );

      expect(confirmAllCalls).toHaveLength(0);
      expect(applyCalls).toBe(1);
    } finally {
      receipt.status = status;
    }
  });
});

describe("when it does not work", () => {
  it("says a refused review failed, rather than nothing at all", async () => {
    failing = true;
    render();

    await userEvent.click(
      screen.getByRole("button", { name: es.receipts.applyToInventory }),
    );

    // There was no error path at all. The button re-enabled, the pending
    // count did not move, no text was written anywhere in the document, and
    // `mutateAsync` rejected into an unhandled promise rejection — so a
    // screen-reader user was told nothing had happened and a sighted one
    // reasonably pressed it again (WCAG 3.3.1).
    expect(
      await screen.findAllByText(es.receipts.confirmAllFailed),
    ).not.toHaveLength(0);
  });

  it("does not apply what it could not confirm", async () => {
    failing = true;
    render();

    await userEvent.click(
      screen.getByRole("button", { name: es.receipts.applyToInventory }),
    );

    expect(applyCalls).toBe(0);
    expect(pushes).toEqual([]);
  });
});

it("passes axe at AAA", async () => {
  const { container } = render();
  await screen.findByRole("button", { name: es.receipts.applyToInventory });
  expect(await axeViolations(container)).toBe("");
});
