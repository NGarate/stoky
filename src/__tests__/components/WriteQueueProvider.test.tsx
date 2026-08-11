import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, mock } from "bun:test";
import { act, cleanup, screen } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { renderWithIntl } from "../utils/render";

/**
 * The triggers.
 *
 * The queue's own behaviour is tested without a renderer — that is what
 * `zustand/vanilla` buys. What can only be asked here is whether the browser
 * events reach it at all, and what a drain costs in refetches.
 */

const invalidate = mock(() => Promise.resolve());

mock.module("@/lib/trpc/client", () => ({
  api: { useUtils: () => ({ invalidate }) },
}));

const { WriteQueueProvider, useWriteQueue } = await import(
  "@/components/offline/WriteQueueProvider"
);
const { openWriteQueue } = await import("@/lib/offline/queue");
const { createMemoryStorage } = await import("@/lib/offline/storage");

function Readout() {
  const { state } = useWriteQueue();
  return <p data-testid="pending">{state.pending.length}</p>;
}

/** A queue whose sender is controlled by the test. */
function makeQueue(send: () => Promise<unknown>) {
  return openWriteQueue({
    userId: "clttttttttttttttttttttttt",
    householdId: "clhhhhhhhhhhhhhhhhhhhhhhh",
    send,
    storage: createMemoryStorage(),
  });
}

const tick = {
  path: "shopping.updateItem" as const,
  input: { id: "item-1", isChecked: true },
  label: { key: "offline.tickedOff" },
};

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(navigator, "onLine", {
    value,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  invalidate.mockClear();
  setNavigatorOnline(true);
  onlineManager.setOnline(true);
});

afterEach(cleanup);

describe("the drain triggers", () => {
  it("sends what is already waiting as soon as it is mounted", async () => {
    const send = mock(async () => {});
    const queue = makeQueue(send);
    queue.enqueue(tick);

    await act(async () => {
      renderWithIntl(
        <WriteQueueProvider queue={queue}>
          <Readout />
        </WriteQueueProvider>,
      );
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("pending")).toHaveTextContent("0");
  });

  it("sends when the connection comes back", async () => {
    const send = mock(async () => {});
    const queue = makeQueue(send);

    await act(async () => {
      renderWithIntl(
        <WriteQueueProvider queue={queue}>
          <Readout />
        </WriteQueueProvider>,
      );
    });

    onlineManager.setOnline(false);
    queue.enqueue(tick);
    send.mockClear();

    await act(async () => {
      onlineManager.setOnline(true);
    });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does nothing extra when the connection is merely reported as lost", async () => {
    const send = mock(async () => {});
    const queue = makeQueue(send);

    await act(async () => {
      renderWithIntl(
        <WriteQueueProvider queue={queue}>
          <Readout />
        </WriteQueueProvider>,
      );
    });
    send.mockClear();

    await act(async () => {
      onlineManager.setOnline(false);
    });

    expect(send).not.toHaveBeenCalled();
  });

  it("sends when the tab becomes visible again", async () => {
    const send = mock(async () => {});
    const queue = makeQueue(send);

    await act(async () => {
      renderWithIntl(
        <WriteQueueProvider queue={queue}>
          <Readout />
        </WriteQueueProvider>,
      );
    });

    queue.enqueue(tick);
    send.mockClear();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // A phone taken out of a pocket reports for duty this way.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends a change made while online without waiting for anything", async () => {
    const send = mock(async () => {});
    const queue = makeQueue(send);

    // A real control rather than a handle captured out of render: assigning
    // to an outer binding while rendering is the same Rules of React
    // violation the provider was just corrected for.
    function Enqueuer() {
      const { enqueue } = useWriteQueue();
      return (
        <button type="button" onClick={() => enqueue(tick)}>
          add
        </button>
      );
    }

    await act(async () => {
      renderWithIntl(
        <WriteQueueProvider queue={queue}>
          <Enqueuer />
        </WriteQueueProvider>,
      );
    });

    await act(async () => {
      screen.getByRole("button", { name: "add" }).click();
    });

    // There is no separate "online" path: everything goes through the queue,
    // so there is one code path to get wrong instead of two.
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("two triggers at once", () => {
  it("produces one send, not one per trigger", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = mock(async () => {
      await gate;
    });
    const queue = makeQueue(send);
    queue.enqueue(tick);
    queue.enqueue({ ...tick, input: { id: "item-2", isChecked: true } });

    await act(async () => {
      renderWithIntl(
        <WriteQueueProvider queue={queue}>
          <Readout />
        </WriteQueueProvider>,
      );
    });

    // The first operation is in flight. Every other trigger fires now. The
    // guard that makes this hold lives in the queue, not in the provider —
    // this asserts the property end to end rather than where it is enforced.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      onlineManager.setOnline(true);
    });

    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await Promise.resolve();
    });
  });
});

describe("refreshing what is on screen", () => {
  it("invalidates once for a whole drain, not once per change", async () => {
    const send = mock(async () => {});
    const queue = makeQueue(send);
    for (let i = 0; i < 5; i += 1) {
      queue.enqueue({ ...tick, input: { id: `item-${i}`, isChecked: true } });
    }

    await act(async () => {
      renderWithIntl(
        <WriteQueueProvider queue={queue}>
          <Readout />
        </WriteQueueProvider>,
      );
    });

    expect(send).toHaveBeenCalledTimes(5);
    // Forty queued changes should cost one refetch, not forty.
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when nothing was sent", async () => {
    const queue = makeQueue(async () => {});

    await act(async () => {
      renderWithIntl(
        <WriteQueueProvider queue={queue}>
          <Readout />
        </WriteQueueProvider>,
      );
    });

    expect(invalidate).not.toHaveBeenCalled();
  });
});
