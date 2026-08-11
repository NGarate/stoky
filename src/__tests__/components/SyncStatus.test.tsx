import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";
import type { FailedOp, QueuedOp } from "@/lib/offline/queue";

/**
 * What the shell shows about the queue, and where a screen reader hears it.
 *
 * The rendered tier because the questions are about the DOM: which region a
 * message lands in, whether both regions exist at once, and whether every state
 * has words rather than a colour.
 */

const adjustMutate = mock((_input: unknown) => {});
const discard = mock((_id: string) => {});
const retry = mock((_id: string) => {});
const drain = mock(() => {});

let queueState = {
  pending: [] as QueuedOp[],
  failed: [] as FailedOp[],
  status: "idle" as "idle" | "sending" | "needs-signin",
  full: false,
};

let productQuery: unknown = {
  data: { name: "Leche entera", defaultUnit: "L", stockEntries: [] },
  error: null,
};

mock.module("@/components/offline/queue-context", () => ({
  // A real context as well as the hook. `mock.module` replaces the module for
  // the whole process, and `WriteQueueProvider` renders
  // `WriteQueueContext.Provider` — so a mock that omits it turns the provider
  // into a syntax error in whichever suite renders the real one.
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: queueState,
    enqueue: () => ({ ok: true, id: "x" }),
    drain,
    retry,
    discard,
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    product: { getById: { useQuery: () => productQuery } },
    inventory: {
      adjustStock: {
        useMutation: () => ({ mutate: adjustMutate, isPending: false }),
      },
    },
  },
}));

const { SyncStatus } = await import("@/components/offline/SyncStatus");

function op(id: string): QueuedOp {
  return {
    id,
    path: "inventory.consumeStock",
    input: { productId: "p1", quantity: 2, unit: "L" },
    householdId: "h1",
    label: { key: "offline.pending", values: { count: 1 } },
    createdAt: new Date("2026-08-11T10:00:00.000Z"),
    attempts: 0,
  };
}

function failed(id: string, reason: FailedOp["reason"]): FailedOp {
  return { ...op(id), reason };
}

beforeEach(() => {
  adjustMutate.mockClear();
  discard.mockClear();
  retry.mockClear();
  drain.mockClear();
  queueState = { pending: [], failed: [], status: "idle", full: false };
  productQuery = {
    data: { name: "Leche entera", defaultUnit: "L", stockEntries: [] },
    error: null,
  };
});

afterEach(cleanup);

describe("the two live regions", () => {
  it("both exist even when neither has anything to say", () => {
    renderWithIntl(<SyncStatus />);

    // Created at the moment it has something to announce is a region screen
    // readers may not announce at all.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("puts what is waiting in the calm one", () => {
    queueState = { ...queueState, pending: [op("a"), op("b")] };
    renderWithIntl(<SyncStatus />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "2 cambios sin enviar",
    );
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("puts a session that ended in the urgent one", () => {
    queueState = { ...queueState, status: "needs-signin", pending: [op("a")] };
    renderWithIntl(<SyncStatus />);

    expect(screen.getByRole("alert")).toHaveTextContent(/vuelve a entrar/i);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says nothing at all when everything is saved", () => {
    renderWithIntl(<SyncStatus />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });
});

describe("every state has words", () => {
  const cases: { name: string; apply: () => void }[] = [
    { name: "pending", apply: () => { queueState.pending = [op("a")]; } },
    {
      name: "syncing",
      apply: () => {
        queueState.status = "sending";
        queueState.pending = [op("a")];
      },
    },
    { name: "needs-signin", apply: () => { queueState.status = "needs-signin"; } },
    { name: "full", apply: () => { queueState.full = true; } },
    {
      name: "failed",
      apply: () => { queueState.failed = [failed("f", "refused")]; },
    },
    {
      name: "needs-reconciliation",
      apply: () => {
        queueState.failed = [failed("f", "needs-reconciliation")];
      },
    },
  ];

  for (const { name, apply } of cases) {
    it(`${name} is announced in words, not colour`, () => {
      apply();
      renderWithIntl(<SyncStatus />);

      const region = screen.getByRole(
        ["pending", "syncing"].includes(name) ? "status" : "alert",
      );
      expect(region.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    });
  }
});

describe("a change that did not save", () => {
  it("offers to try it again or to let it go", async () => {
    queueState = { ...queueState, failed: [failed("f1", "refused")] };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledWith("f1");

    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(discard).toHaveBeenCalledWith("f1");
  });

  it("offers to send now, which is the only answer to a captive portal", async () => {
    queueState = { ...queueState, failed: [failed("f1", "refused")] };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Enviar ahora" }));
    expect(drain).toHaveBeenCalledTimes(1);
  });
});

describe("a refused consumption", () => {
  beforeEach(() => {
    queueState = {
      ...queueState,
      failed: [failed("f1", "needs-reconciliation")],
    };
  });

  it("is named as something to check, not as a failure", () => {
    renderWithIntl(<SyncStatus />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /hay que comprobar 1 producto/i,
    );
  });

  it("does not interrupt: the dialog opens only when asked for", async () => {
    renderWithIntl(<SyncStatus />);

    // A conflict is discovered on reconnect, with the phone in a pocket. A
    // dialog thrown then interrupts someone who cannot answer it.
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("asks what is actually there, and adjusts to that number", async () => {
    productQuery = {
      data: {
        name: "Leche entera",
        defaultUnit: "L",
        stockEntries: [{ quantity: 6 }, { quantity: -5 }],
      },
      error: null,
    };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await userEvent.type(
      screen.getByLabelText(/cuánto hay ahora/i),
      "3",
    );
    // The button is asserted separately from the submission: happy-dom does
    // not perform implicit form submission when a submit button is clicked, so
    // clicking alone would prove nothing — and submitting alone would not
    // notice a button stuck disabled.
    const submit = screen.getByRole("button", { name: "Guardar la cantidad" });
    expect(submit).not.toBeDisabled();

    const form = screen.getByRole("dialog").querySelector("form");
    await act(async () => {
      fireEvent.submit(form as HTMLFormElement);
    });

    // The person answers an absolute — what is on the shelf. The delta against
    // the server's net of 1 is arithmetic, and arithmetic is our job.
    expect(adjustMutate).toHaveBeenCalledTimes(1);
    const call = adjustMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.quantity).toBe(2);
    expect(call.productId).toBe("p1");
    expect(String(call.reason).length).toBeGreaterThan(0);
    // No `operationType`. It was required by the shared input schema and then
    // ignored by the procedure, which always writes ADJUST (ISSUES.md UI-3
    // item 1); the schema no longer asks for it, and sending it again would be
    // a caller inventing a field the server discards.
    expect(call).not.toHaveProperty("operationType");
  });

  it("lets the change be dropped instead", async () => {
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Descartar este cambio" }),
    );

    expect(discard).toHaveBeenCalledWith("f1");
    expect(adjustMutate).not.toHaveBeenCalled();
  });

  it("tells a kitchen account who can fix it, rather than offering a control", async () => {
    // `adjustStock` is a writeProcedure and the matrix gives KITCHEN looking
    // and consuming. Offering a control the server would refuse is worse than
    // not offering one.
    productQuery = { data: undefined, error: new Error("forbidden") };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      /no ajustar el stock/i,
    );
    expect(screen.queryByLabelText(/cuánto hay ahora/i)).toBeNull();
  });
});

describe("the dialog itself", () => {
  it("takes focus when it opens", async () => {
    queueState = {
      ...queueState,
      failed: [failed("f1", "needs-reconciliation")],
    };
    renderWithIntl(<SyncStatus />);

    await act(async () => {
      screen.getByRole("button", { name: "Revisar" }).click();
    });

    // Otherwise the keyboard and a screen reader land back at the top of the
    // page and never find the question.
    expect(document.activeElement).toBe(
      screen.getByRole("dialog").firstElementChild,
    );
  });

  it("says what happened before it asks anything", async () => {
    queueState = {
      ...queueState,
      failed: [failed("f1", "needs-reconciliation")],
    };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      /apuntaste que usabas 2 L de «Leche entera»/i,
    );
  });
});
