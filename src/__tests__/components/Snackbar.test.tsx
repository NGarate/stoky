import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createContext } from "react";
import { renderWithIntl } from "../utils/render";

/**
 * The one snackbar.
 *
 * Three of these assertions exist because of a defect this shell has already
 * shipped or been warned about, and they are the ones not to relax:
 *
 * - **Never `role="alert"`.** `SyncStatus.tsx:64-69` records that a live
 *   region's role must not alternate and that Next's route announcer is
 *   already an alert, so a second one makes `getByRole("alert")` ambiguous in
 *   every browser test.
 * - **Never steal an undo.** A confirmation that replaces a visible undo takes
 *   away the button someone is reaching for — the failure D54 rejected toasts
 *   over.
 * - **Undo is `cancel`, never a compensating write** (D57).
 */

const cancel = mock((_id: string) => true);
let holdRemaining = 10_000;

mock.module("@/components/offline/queue-context", () => ({
  WriteQueueContext: createContext(null),
  useWriteQueue: () => ({
    state: { pending: [], failed: [], status: "idle", full: false },
    enqueue: () => ({ ok: true, id: "op" }),
    drain: () => {},
    cancel,
    holdRemainingMs: () => holdRemaining,
    retry: () => {},
    discard: () => {},
    flush: async () => {},
    purgeAll: () => {},
  }),
}));

const { SnackbarProvider, useSnackbar } = await import(
  "@/components/ui/snackbar"
);

/** A button per snackbar shape, so a test can fire one by clicking. */
function Harness({
  onUndo,
}: {
  onUndo?: () => void;
}): React.JSX.Element {
  const snackbar = useSnackbar();
  return (
    <>
      <button
        onClick={() =>
          snackbar.show({
            kind: "confirm",
            message: { key: "offline.tickedOff", values: { name: "Leche" } },
          })
        }
        type="button"
      >
        confirmar
      </button>
      <button
        onClick={() =>
          snackbar.show({
            kind: "confirm",
            message: { key: "offline.removedItem", values: { name: "Pan" } },
          })
        }
        type="button"
      >
        confirmar otro
      </button>
      <button
        onClick={() =>
          snackbar.show({
            kind: "undo-queued",
            message: { key: "offline.usedUp", values: { quantity: 1, unit: "L", name: "Leche" } },
            opId: "op-1",
          })
        }
        type="button"
      >
        deshacible
      </button>
      <button
        onClick={() =>
          snackbar.show({
            kind: "undo-queued",
            message: { key: "offline.addedStock", values: { quantity: 2, unit: "L", name: "Pan" } },
            opId: "op-2",
          })
        }
        type="button"
      >
        deshacible otro
      </button>
      <button
        onClick={() =>
          snackbar.show({
            kind: "undo-inverse",
            message: { key: "offline.addedItem", values: { name: "Pan" } },
            undo: () => onUndo?.(),
          })
        }
        type="button"
      >
        inverso
      </button>
    </>
  );
}

const render = (onUndo?: () => void) =>
  renderWithIntl(
    <SnackbarProvider>
      <Harness onUndo={onUndo} />
    </SnackbarProvider>,
    { locale: "es" },
  );

const press = async (name: string): Promise<void> => {
  await userEvent.click(screen.getByRole("button", { name }));
};

beforeEach(() => {
  cancel.mockClear();
  holdRemaining = 10_000;
  window.localStorage.clear();
});

afterEach(cleanup);

describe("the snackbar's live region", () => {
  it("is never role=alert, in any state", async () => {
    const { baseElement } = render();

    expect(baseElement.querySelectorAll('[role="alert"]')).toHaveLength(0);
    await press("confirmar");
    expect(baseElement.querySelectorAll('[role="alert"]')).toHaveLength(0);
    await press("deshacible");
    expect(baseElement.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it("announces politely, so it never interrupts what is being read", async () => {
    const { baseElement } = render();
    await press("confirmar");

    const live = [...baseElement.querySelectorAll("[aria-live]")];
    expect(live.length).toBeGreaterThan(0);
    for (const region of live) {
      expect(region.getAttribute("aria-live")).not.toBe("assertive");
    }
  });

  it("names the key that reaches it, because a ten-second undo is not tabbable", async () => {
    const { baseElement } = render();

    const region = baseElement.querySelector('[role="region"]');
    expect(region?.getAttribute("aria-label")).toContain("F8");
  });
});

describe("what the snackbar says", () => {
  it("renders the stored label rather than a sentence composed at the call site", async () => {
    render();
    await press("confirmar");

    // The op label is `{key, values}` so that a queue composed in Spanish and
    // read after a language switch is not half in each (queue.ts:41-47).
    expect(await screen.findAllByText("Marcaste «Leche»")).not.toHaveLength(0);
  });

  it("offers no undo on a plain confirmation", async () => {
    render();
    await press("confirmar");

    await screen.findAllByText("Marcaste «Leche»");
    expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull();
  });
});

describe("undo", () => {
  it("takes the queued change back, and never writes a compensating one", async () => {
    render();
    await press("deshacible");

    await userEvent.click(
      await screen.findByRole("button", { name: "Deshacer" }),
    );

    // D57: a stock movement that never happened must leave no trace. A
    // compensating addStock would record an acquisition the household never
    // made, indistinguishable downstream from a real one.
    expect(cancel).toHaveBeenCalledWith("op-1");
  });

  it("does not offer a button that will stop working before it is pressed", async () => {
    holdRemaining = 900;
    render();
    await press("deshacible");

    // Two matches by design: the visible title and Radix's announced copy.
    await screen.findAllByText(/Usaste/);
    expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull();
  });

  it("keeps the undo it opened with while the window ticks down", async () => {
    render();
    await press("deshacible");
    await screen.findByRole("button", { name: "Deshacer" });

    // Time passes and something else re-renders the shell — which happens
    // constantly in the real application, because the queue ticks.
    holdRemaining = 500;
    await press("confirmar");

    // The window was read on every render, so the button vanished under the
    // hand reaching for it. Worse and invisibly: Radix restarts its close
    // timer whenever `duration` changes, and once the remainder fell below
    // MIN_UNDO_MS the duration fell through to the *preference* — so the
    // snackbar outlived the window it was measuring, and under "hasta
    // descartar" it never closed at all.
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
  });

  it("runs the inverse when there is an exact one", async () => {
    const undo = mock(() => {});
    render(undo);
    await press("inverso");

    await userEvent.click(
      await screen.findByRole("button", { name: "Deshacer" }),
    );

    expect(undo).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("two things at once", () => {
  it("replaces one confirmation with the next: nobody needs the previous one", async () => {
    render();
    await press("confirmar");
    await screen.findAllByText("Marcaste «Leche»");

    await press("confirmar otro");

    await waitFor(() => {
      expect(screen.getAllByText("Quitaste «Pan» de la lista")).not.toHaveLength(0);
    });
    expect(screen.queryAllByText("Marcaste «Leche»")).toHaveLength(0);
  });

  it("gives a second undoable action its own undo, not one ten seconds late", async () => {
    render();
    await press("deshacible");
    await screen.findByRole("button", { name: "Deshacer" });

    await press("deshacible otro");

    // They used to queue, one visible at a time. So tapping two things in
    // quick succession showed the second's confirmation when the first had
    // finished — up to ten seconds later, by which point its own window had
    // run out and it arrived with no undo at all. Two independent windows
    // are two snackbars.
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Deshacer" })).toHaveLength(2);
    });
  });

  it("never takes away an undo to show a confirmation", async () => {
    render();
    await press("deshacible");
    await screen.findByRole("button", { name: "Deshacer" });

    await press("confirmar");

    // The exact failure D54 rejected toasts over: the button someone is
    // reaching for must not vanish because something else happened.
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
    expect(screen.queryAllByText("Marcaste «Leche»")).toHaveLength(0);
  });
});

describe("dismissing", () => {
  it("can be closed by hand, whatever the timer says", async () => {
    render();
    await press("confirmar");
    await screen.findAllByText("Marcaste «Leche»");

    await userEvent.click(
      screen.getByRole("button", { name: "Descartar el aviso" }),
    );

    await waitFor(() => {
      expect(screen.queryAllByText("Marcaste «Leche»")).toHaveLength(0);
    });
  });
});
