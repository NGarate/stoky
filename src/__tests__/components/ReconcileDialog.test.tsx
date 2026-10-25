import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { createContext, useState } from "react";
import { renderWithIntl as renderWithIntlOnly } from "../utils/render";
import type { FailedOp } from "@/lib/offline/queue";

/**
 * The question a refused consumption becomes.
 *
 * Its answer is an `adjustStock`: a direct write that corrects the count, so
 * every screen still showing the old one is wrong until it asks again.
 */

const discard = mock((_id: string): FailedOp | null => null);
const restore = mock((_op: FailedOp) => {});
let invalidated: string[] = [];
let role = "OWNER";

mock.module("@/lib/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending: [], failed: [], status: "idle", full: false },
    enqueue: () => ({ ok: true, id: "op" }),
    drain: () => {},
    cancel: () => true,
    holdRemainingMs: () => 0,
    retry: () => {},
    discard,
    restore,
    flush: async () => 0,
    purgeAll: () => {},
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({
      inventory: { invalidate: async () => void invalidated.push("inventory") },
      product: { invalidate: async () => void invalidated.push("product") },
      shopping: { invalidate: async () => void invalidated.push("shopping") },
    }),
    auth: { me: { useQuery: () => ({ data: { role } }) } },
    product: {
      getById: {
        useQuery: () => ({
          data: {
            id: "p1",
            name: "Leche entera",
            defaultUnit: "L",
            stockEntries: [{ quantity: 1 }],
          },
          error: null,
        }),
      },
    },
    inventory: {
      adjustStock: {
        useMutation: (callbacks: { onSuccess?: () => void }) => ({
          mutate: () => callbacks.onSuccess?.(),
          isPending: false,
        }),
      },
    },
  },
}));

const { ReconcileDialog } =
  await import("@/components/offline/ReconcileDialog");

const { SnackbarProvider } = await import("@/components/ui/snackbar");

/**
 * Inside the snackbar, as the shell mounts it: discarding a change offers its
 * undo there, so the component cannot render without one.
 */
const renderWithIntl = (
  ui: React.ReactElement,
  options?: Parameters<typeof renderWithIntlOnly>[1],
) => renderWithIntlOnly(<SnackbarProvider>{ui}</SnackbarProvider>, options);

const op: FailedOp = {
  id: "op-1",
  path: "inventory.consumeStock",
  input: { productId: "p1", quantity: 2, unit: "L" },
  householdId: "h1",
  label: { key: "offline.usedUp", values: { name: "Leche entera" } },
  createdAt: new Date("2026-08-11T10:00:00.000Z"),
  attempts: 1,
  reason: "needs-reconciliation",
};

beforeEach(() => {
  invalidated = [];
  role = "OWNER";
  discard.mockClear();
});

afterEach(cleanup);

describe("answering the question", () => {
  it("refreshes every screen that shows stock once the count is corrected", async () => {
    // It discarded the queued change and closed, and refreshed nothing: the
    // person had just settled what is on the shelf, and the screens went on
    // showing the count they had just said was wrong.
    renderWithIntl(<ReconcileDialog onClose={() => {}} op={op} />);

    fireEvent.change(screen.getByLabelText(/¿Cuánto hay ahora/), {
      target: { value: "3" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Guardar la cantidad" })
        .closest("form") as HTMLFormElement,
    );

    expect(discard).toHaveBeenCalledWith("op-1");
    expect(invalidated).toEqual(
      expect.arrayContaining(["inventory", "product", "shopping"]),
    );
  });
});

describe("the scrim", () => {
  it("dims the page with the theme's ink, like every other dialog", () => {
    renderWithIntl(<ReconcileDialog onClose={() => {}} op={op} />);

    // `bg-black/50` was the one scrim outside the tokens: Dialog and the nav
    // sheet use `bg-foreground/60`, which follows the theme at night.
    const scrim = document.querySelector(".fixed.inset-0") as HTMLElement;
    expect(scrim.className).toContain("bg-foreground/60");
    expect(scrim.className).not.toContain("bg-black");
  });
});

describe("who may answer it", () => {
  it("does not offer a kitchen account a form the server will refuse", () => {
    // The product loads for KITCHEN — `getById` is a householdProcedure — so
    // deciding from that query failing offered the form to every kitchen
    // account, and every answer came back FORBIDDEN.
    role = "KITCHEN";
    renderWithIntl(<ReconcileDialog onClose={() => {}} op={op} />);

    expect(screen.queryByLabelText(/¿Cuánto hay ahora/)).toBeAbsent();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      /no corregir la cantidad/i,
    );
  });
});

describe("while somebody is typing", () => {
  it("keeps focus in the amount when the banner around it re-renders", () => {
    // The banner passes an inline `onClose`, a new one on every render, and
    // the focus effect depended on it — so each re-render sent focus to the
    // opener and back to the card, out of the box being typed into.
    let rerender: () => void = () => {};
    function Banner() {
      const [, setTick] = useState(0);
      rerender = () => setTick((tick) => tick + 1);
      return <ReconcileDialog onClose={() => {}} op={op} />;
    }
    renderWithIntl(<Banner />);

    const amount = screen.getByLabelText(/¿Cuánto hay ahora/);
    amount.focus();
    act(() => rerender());

    expect(document.activeElement).toBe(amount);
  });
});
