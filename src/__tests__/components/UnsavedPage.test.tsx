import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { createContext } from "react";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../utils/render";
import type { FailedOp, FailureReason } from "@/lib/offline/queue";

/**
 * `/settings/unsaved` — what did not save, found deliberately rather than
 * caught on a banner.
 *
 * The sync indicator already names failures inline, which is right at the
 * moment they happen and wrong an hour later. What this route adds, and what
 * is worth testing, is that every reason is said in words and that each change
 * carries *when* it was made — the thing that makes "was this the milk from
 * Tuesday?" answerable.
 */

const retry = mock((_id: string) => {});
const discard = mock((_id: string) => {});

let failed: FailedOp[] = [];

mock.module("@/lib/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending: [], failed, status: "idle", full: false },
    enqueue: () => ({ ok: true as const, id: "x" }),
    cancel: () => true,
    drain: () => {},
    retry,
    discard,
    flush: async () => {},
    purgeAll: () => {},
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ invalidate: () => Promise.resolve() }),
    // The reconcile dialog asks who is looking before offering an adjustment.
    auth: { me: { useQuery: () => ({ data: { role: "OWNER" } }) } },
    product: {
      getById: {
        useQuery: () => ({
          data: { name: "Leche entera", defaultUnit: "L", stockEntries: [] },
          error: null,
        }),
      },
    },
    inventory: {
      adjustStock: {
        useMutation: () => ({ mutate: () => {}, isPending: false }),
      },
    },
  },
}));

const { default: UnsavedPage } = await import(
  "@/app/(dashboard)/settings/unsaved/page"
);

function failure(reason: FailureReason, id = "op-1"): FailedOp {
  return {
    id,
    path: reason === "needs-reconciliation" ? "inventory.consumeStock" : "shopping.updateItem",
    input: { productId: "p1", quantity: 1, unit: "L", id: "item-1" },
    householdId: "h1",
    label: { key: "offline.usedUp", values: { quantity: 1, unit: "L", name: "Leche entera" } },
    createdAt: new Date("2026-08-11T09:30:00.000Z"),
    attempts: 0,
    reason,
  };
}

beforeEach(() => {
  retry.mockClear();
  discard.mockClear();
  failed = [];
});

afterEach(cleanup);

describe("when nothing is waiting", () => {
  it("says so rather than showing an empty list", () => {
    renderWithIntl(<UnsavedPage />);

    expect(screen.getByText("No hay nada pendiente")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeAbsent();
  });
});

describe("what each change says", () => {
  beforeEach(() => {
    failed = [failure("refused")];
  });

  it("names what the change was", () => {
    renderWithIntl(<UnsavedPage />);

    expect(screen.getByText(/Usaste 1 L de «Leche entera»/)).toBeInTheDocument();
  });

  it("draws letting it go as the destructive action it is", () => {
    renderWithIntl(<UnsavedPage />);

    expect(screen.getByRole("button", { name: "Descartar" }).className).toContain(
      "bg-destructive",
    );
  });

  it("names a change whose label lives outside the offline catalogue", () => {
    // Read through the `offline` namespace, `shopping.itemUpdated` was shown
    // as the raw key "offline.shopping.itemUpdated".
    failed = [
      {
        ...failure("refused"),
        label: { key: "shopping.itemUpdated", values: { name: "Leche entera" } },
      },
    ];
    renderWithIntl(<UnsavedPage />);

    expect(screen.getByText(/Cambiaste «Leche entera»/)).toBeInTheDocument();
    expect(screen.queryByText(/shopping\.itemUpdated/)).toBeAbsent();
  });

  it("says when it was made", () => {
    renderWithIntl(<UnsavedPage />);

    // The banner cannot say this, and it is what makes an hour-old failure
    // identifiable at all.
    const when = screen.getByText("Apuntado");
    expect(when.tagName).toBe("DT");
    expect(when.nextElementSibling?.textContent).toMatch(/2026/);
  });

  it("is drawn on the list row, with its state as a badge", () => {
    // A hand-written card per change: its own title paragraph, its own meta
    // paragraphs, and no status at all — the one screen of failures with no
    // word for which state each one was in.
    renderWithIntl(<UnsavedPage />);

    const item = screen.getByRole("listitem");
    expect(within(item).getByText("No guardado")).toBeInTheDocument();
    expect(item.querySelector("dl")).not.toBeNull();
  });

  it("says why, in words rather than a code", () => {
    renderWithIntl(<UnsavedPage />);

    expect(screen.getByText("El servidor no lo aceptó.")).toBeInTheDocument();
  });
});

describe("every reason has words", () => {
  const reasons: FailureReason[] = [
    "needs-reconciliation",
    "wrong-household",
    "refused",
    "gone",
    "invalid",
    "exhausted",
  ];

  for (const reason of reasons) {
    it(`${reason} is explained`, () => {
      failed = [failure(reason)];
      renderWithIntl(<UnsavedPage />);

      // A reason with no sentence would render the raw key, which next-intl
      // does instead of throwing — source code on screen.
      const item = screen.getByRole("listitem");
      expect(item.textContent).not.toContain("reason");
      expect(item.textContent?.length ?? 0).toBeGreaterThan(40);
    });
  }
});

describe("what can be done about it", () => {
  it("offers to try an ordinary failure again", async () => {
    failed = [failure("refused")];
    renderWithIntl(<UnsavedPage />);

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(retry).toHaveBeenCalledWith("op-1");
  });

  it("offers to let it go", async () => {
    failed = [failure("exhausted")];
    renderWithIntl(<UnsavedPage />);

    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));

    expect(discard).toHaveBeenCalledWith("op-1");
  });

  it("opens the reconciliation for a stock disagreement, not a retry", async () => {
    failed = [failure("needs-reconciliation")];
    renderWithIntl(<UnsavedPage />);

    // Retrying would be refused again for the same reason. The question is
    // for a person.
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeAbsent();

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not interrupt: nothing opens on its own", () => {
    failed = [failure("needs-reconciliation")];
    renderWithIntl(<UnsavedPage />);

    expect(screen.queryByRole("dialog")).toBeAbsent();
  });
});

describe("more than one", () => {
  it("lists each separately", () => {
    failed = [failure("refused", "a"), failure("exhausted", "b")];
    renderWithIntl(<UnsavedPage />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
