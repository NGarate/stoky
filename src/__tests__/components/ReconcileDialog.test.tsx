import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";
import type { FailedOp } from "@/lib/offline/queue";

/**
 * The question a refused consumption becomes.
 *
 * Its answer is an `adjustStock`: a direct write that corrects the count, so
 * every screen still showing the old one is wrong until it asks again.
 */

const discard = mock((_id: string) => {});
let invalidated: string[] = [];

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

const { ReconcileDialog } = await import("@/components/offline/ReconcileDialog");

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
      screen.getByRole("button", { name: "Guardar la cantidad" }).closest("form") as HTMLFormElement,
    );

    expect(discard).toHaveBeenCalledWith("op-1");
    expect(invalidated).toEqual(
      expect.arrayContaining(["inventory", "product", "shopping"]),
    );
  });
});
