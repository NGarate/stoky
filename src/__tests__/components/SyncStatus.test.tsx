import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl as renderWithIntlOnly } from "../utils/render";
import type { FailedOp, QueuedOp } from "@/lib/offline/queue";
import { Decimal } from "@prisma/client-runtime-utils";

/**
 * What the shell shows about the queue, and where a screen reader hears it.
 *
 * The rendered tier because the questions are about the DOM: which region a
 * message lands in, whether both regions exist at once, and whether every state
 * has words rather than a colour.
 */

const adjustMutate = mock((_input: unknown) => {});
const discard = mock(
  (id: string) => queueState.failed.find((op) => op.id === id) ?? null,
);
const restore = mock((_op: FailedOp) => {});
const retry = mock((_id: string) => {});
const drain = mock(() => {});

let queueState = {
  pending: [] as QueuedOp[],
  failed: [] as FailedOp[],
  status: "idle" as "idle" | "sending" | "needs-signin",
  full: false,
  unsaved: false,
  hydrated: true,
};

/** Who is looking: the reconcile dialog asks before offering an adjustment. */
let role = "OWNER";

let productQuery: unknown = {
  data: {
    name: "Leche entera",
    defaultUnit: "L",
    totalStock: new Decimal(0),
  },
  error: null,
};

mock.module("@/lib/offline/queue-context", () => ({
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
    restore,
    cancel: () => true,
    holdRemainingMs: () => 0,
  }),
}));

mock.module("@/lib/trpc/client", () => ({
  api: {
    // The dialog refreshes what a corrected count makes stale.
    useUtils: () => ({
      inventory: { invalidate: async () => {} },
      product: { invalidate: async () => {} },
      shopping: { invalidate: async () => {} },
    }),
    auth: { me: { useQuery: () => ({ data: { role } }) } },
    product: { getById: { useQuery: () => productQuery } },
    inventory: {
      adjustStock: {
        useMutation: () => ({ mutate: adjustMutate, isPending: false }),
      },
    },
  },
}));

const { SyncStatus } = await import("@/components/offline/SyncStatus");

const { SnackbarProvider } = await import("@/components/ui/snackbar");

/**
 * Inside the snackbar, as the shell mounts it: discarding a change offers its
 * undo there, so the component cannot render without one.
 */
const renderWithIntl = (
  ui: React.ReactElement,
  options?: Parameters<typeof renderWithIntlOnly>[1],
) => renderWithIntlOnly(<SnackbarProvider>{ui}</SnackbarProvider>, options);

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
  // `hydrated: true` is the resting state every other test here means: a queue
  // that has read the device and found nothing. The two that care about the
  // other case set it themselves.
  queueState = {
    pending: [],
    failed: [],
    status: "idle",
    full: false,
    unsaved: false,
    hydrated: true,
  };
  productQuery = {
    data: {
      name: "Leche entera",
      defaultUnit: "L",
      totalStock: new Decimal(0),
    },
    error: null,
  };
  role = "OWNER";
});

afterEach(cleanup);

describe("an unread queue is not a saved one", () => {
  /**
   * The calm region renders *nothing* when everything is saved — and an
   * unhydrated queue is empty, so it renders nothing then too. Identical DOM,
   * opposite meanings: one says "there is nothing waiting", the other says
   * "nobody has looked yet".
   *
   * A browser test read the empty region as proof the queue had drained, then
   * reloaded the page on top of changes that had never been sent. `data-sync`
   * is what separates them. It is deliberately not a visible difference: the
   * state lasts one effect, and a spinner for it would be worse than silence.
   */
  it("says it is still reading the device", () => {
    queueState = { ...queueState, hydrated: false };
    renderWithIntl(<SyncStatus />);

    expect(screen.getByTestId("sync-status")).toHaveAttribute(
      "data-sync",
      "hydrating",
    );
  });

  it("says it is ready once the device has been read", () => {
    queueState = { ...queueState, hydrated: true };
    renderWithIntl(<SyncStatus />);

    expect(screen.getByTestId("sync-status")).toHaveAttribute(
      "data-sync",
      "ready",
    );
  });

  it("looks identical either way, which is why the attribute exists", () => {
    queueState = { ...queueState, hydrated: false };
    const { container } = renderWithIntl(<SyncStatus />);
    const unread = container.querySelector(
      '[data-testid="sync-calm"]',
    )?.innerHTML;
    cleanup();

    queueState = { ...queueState, hydrated: true };
    const second = renderWithIntl(<SyncStatus />);
    const saved = second.container.querySelector(
      '[data-testid="sync-calm"]',
    )?.innerHTML;

    expect(unread).toBe(saved);
    expect(saved).toBe("");
  });
});

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

  it("offers the way back in, not a send that cannot work", () => {
    // The drain returns at once while the session is expired, so "Enviar
    // ahora" — the only control this banner had — did nothing at all.
    queueState = { ...queueState, status: "needs-signin", pending: [op("a")] };
    renderWithIntl(<SyncStatus />);

    expect(
      screen.getByRole("link", { name: "Volver a entrar" }),
    ).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "Enviar ahora" })).toBeAbsent();
  });

  it("says nothing at all when everything is saved", () => {
    renderWithIntl(<SyncStatus />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });
});

describe("every state has words", () => {
  const cases: { name: string; apply: () => void }[] = [
    {
      name: "pending",
      apply: () => {
        queueState.pending = [op("a")];
      },
    },
    {
      name: "syncing",
      apply: () => {
        queueState.status = "sending";
        queueState.pending = [op("a")];
      },
    },
    {
      name: "needs-signin",
      apply: () => {
        queueState.status = "needs-signin";
      },
    },
    {
      name: "full",
      apply: () => {
        queueState.full = true;
      },
    },
    {
      name: "unsaved",
      apply: () => {
        queueState.unsaved = true;
        queueState.pending = [op("a")];
      },
    },
    {
      name: "failed",
      apply: () => {
        queueState.failed = [failed("f", "refused")];
      },
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

describe("a change kept only in this tab", () => {
  it("says it could not be saved on the device, and to keep the app open", () => {
    queueState = { ...queueState, unsaved: true, pending: [op("a")] };
    renderWithIntl(<SyncStatus />);

    expect(screen.getByRole("alert").textContent).toContain(
      "No cierres la aplicación",
    );
  });
});

describe("a change that did not save", () => {
  it("names a change whose label lives outside the offline catalogue", () => {
    // A shop or quantity edit is labelled `shopping.itemUpdated`. Read through
    // the `offline` namespace it was shown as the raw key
    // "offline.shopping.itemUpdated".
    queueState = {
      ...queueState,
      failed: [
        {
          ...failed("f1", "refused"),
          label: {
            key: "shopping.itemUpdated",
            values: { name: "Leche entera" },
          },
        },
      ],
    };
    renderWithIntl(<SyncStatus />);

    expect(screen.getByText("Cambiaste «Leche entera»")).toBeInTheDocument();
    expect(screen.queryByText(/shopping\.itemUpdated/)).toBeAbsent();
  });

  it("draws letting it go as the destructive action it is", () => {
    // Discarding deletes an unsent change once its undo has gone. It was
    // drawn in the same filled primary as "Volver a intentarlo" beside it.
    queueState = {
      ...queueState,
      failed: [
        failed("f1", "refused"),
        {
          ...failed("s1", "needs-review"),
          path: "product.resolveScan",
          input: { barcode: "1" },
        },
      ],
    };
    renderWithIntl(<SyncStatus />);

    for (const button of screen.getAllByRole("button", {
      name: /^Descartar: /,
    })) {
      expect(button.className).toContain("bg-destructive");
    }
  });

  it("offers to try it again or to let it go", async () => {
    queueState = { ...queueState, failed: [failed("f1", "refused")] };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(
      screen.getByRole("button", { name: "Volver a intentarlo" }),
    );
    expect(retry).toHaveBeenCalledWith("f1");

    await userEvent.click(screen.getByRole("button", { name: /^Descartar: / }));
    expect(discard).toHaveBeenCalledWith("f1");
  });

  it("offers to send now, which is the only answer to a captive portal", async () => {
    queueState = { ...queueState, failed: [failed("f1", "refused")] };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Enviar ahora" }));
    expect(drain).toHaveBeenCalledTimes(1);
  });
});

describe("a scanned barcode nobody knows yet", () => {
  function scan(id: string): FailedOp {
    return {
      ...op(id),
      path: "product.resolveScan",
      input: { barcode: "8410000999999" },
      label: {
        key: "offline.scannedBarcode",
        values: { barcode: "8410000999999" },
      },
      reason: "needs-review",
    };
  }

  it("offers to name it, with the barcode carried into the create form", () => {
    queueState = { ...queueState, failed: [scan("s1")] };
    renderWithIntl(<SyncStatus />);

    // The review question, not a retry: a scan the server could not resolve is
    // named, not re-sent.
    const link = screen.getByRole("link", { name: "Ponle nombre" });
    expect(link).toHaveAttribute(
      "href",
      "/products/new?barcode=8410000999999&pendingScan=s1",
    );
    // No retry button for it — retry would only 404 again.
    expect(
      screen.queryByRole("button", { name: "Volver a intentarlo" }),
    ).toBeNull();
  });

  it("still lets it be discarded", async () => {
    queueState = { ...queueState, failed: [scan("s1")] };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: /^Descartar: / }));
    expect(discard).toHaveBeenCalledWith("s1");
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
    expect(screen.queryByRole("dialog")).toBeAbsent();

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("asks what is actually there, and adjusts to that number", async () => {
    productQuery = {
      data: {
        name: "Leche entera",
        defaultUnit: "L",
        totalStock: new Decimal(1),
      },
      error: null,
    };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await userEvent.type(screen.getByLabelText(/cuánto hay ahora/i), "3");
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
    //
    // The product loads for a kitchen account — `getById` is a
    // householdProcedure — so the dialog cannot learn the role from it
    // failing. This test used to simulate exactly that failure, which never
    // happens, and so passed while every real kitchen account was offered a
    // form the server refused.
    role = "KITCHEN";
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      /no corregir la cantidad/i,
    );
    expect(screen.queryByLabelText(/cuánto hay ahora/i)).toBeAbsent();
  });
});

describe("the dialog itself", () => {
  it("takes focus when it opens", async () => {
    queueState = {
      ...queueState,
      failed: [failed("f1", "needs-reconciliation")],
    };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));

    // Otherwise the keyboard and a screen reader land back at the top of the
    // page and never find the question.
    //
    // The panel itself, not its first child: `role="dialog"` used to sit on
    // the full-viewport scrim with the card inside it, so the dialog's
    // accessible name covered the whole screen and the card was merely
    // content. It is on the card now, and the card is what takes focus.
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("closes on Escape, which it used to ignore", async () => {
    queueState = {
      ...queueState,
      failed: [failed("f1", "needs-reconciliation")],
    };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    // It declared `aria-modal="true"` — a promise that everything outside is
    // unavailable — with no keydown handler at all. There was no cancel
    // control either, so the only keyboard ways out were submitting an
    // adjustment or pressing the button that throws the queued change away.
    expect(screen.queryByRole("dialog")).toBeAbsent();
  });

  it("gives focus back to the row that opened it", async () => {
    queueState = {
      ...queueState,
      failed: [failed("f1", "needs-reconciliation")],
    };
    renderWithIntl(<SyncStatus />);

    const opener = screen.getByRole("button", { name: "Revisar" });
    await userEvent.click(opener);
    await userEvent.keyboard("{Escape}");

    // It dropped focus on <body>, so a keyboard user restarted at the top of
    // the document every time they closed it.
    expect(opener).toHaveFocus();
  });

  it("offers a way out that is neither saving nor discarding", async () => {
    queueState = {
      ...queueState,
      failed: [failed("f1", "needs-reconciliation")],
    };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(screen.queryByRole("dialog")).toBeAbsent();
    expect(discard).not.toHaveBeenCalled();
  });

  it("does not draw throwing the change away as the way to keep it", async () => {
    queueState = {
      ...queueState,
      failed: [failed("f1", "needs-reconciliation")],
    };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));

    // "Descartar" deletes an unsent change once its undo has gone.
    // Drawn as the filled primary beside "Guardar", it was the same colour
    // as the action that keeps the work — the design system's rule is that
    // the colour says what kind of action it is.
    const save = screen.getByRole("button", { name: /Guardar/ });
    const discardButton = screen.getByRole("button", { name: /Descartar/ });

    expect(discardButton.className).not.toBe(save.className);
    expect(discardButton.className).toContain("destructive");
  });

  it("says what happened before it asks anything", async () => {
    queueState = {
      ...queueState,
      failed: [failed("f1", "needs-reconciliation")],
    };
    renderWithIntl(<SyncStatus />);

    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      /No se pudo guardar el consumo de 2 L de «Leche entera»/i,
    );
  });
});
