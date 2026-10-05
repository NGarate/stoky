import "../setup/matchers";
import { describe, it, expect, afterEach, beforeEach, jest, mock } from "bun:test";
import { act, cleanup } from "@testing-library/react";
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

const { WriteQueueProvider } = await import(
  "@/components/offline/WriteQueueProvider"
);
const { openWriteQueue } = await import("@/lib/offline/queue");
const { createMemoryStorage } = await import("@/lib/offline/storage");

/**
 * The queue is driven directly rather than through `useWriteQueue`.
 *
 * Other suites mock `@/lib/offline/queue-context` to render a component
 * in isolation, and `mock.module` replaces a module for the whole process — so
 * reading the hook here would read whichever mock happened to load first.
 * Everything this suite asks about is observable on the queue itself.
 */
function Readout() {
  return null;
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
    expect(queue.getState().pending).toHaveLength(0);
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

  it("sends a change made after mount without waiting for a trigger", async () => {
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

    // Enqueue, then let the armed timer reach it. There is no separate
    // "online" path: everything goes through the queue, so there is one code
    // path to get wrong instead of two.
    await act(async () => {
      queue.enqueue(tick);
      window.dispatchEvent(new Event("focus"));
    });

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

describe("with no connection", () => {
  it("does not keep retrying a change it cannot send", async () => {
    // A transport failure costs no strike, so the backoff never left its
    // first, sub-second step: offline, the timer fired, failed and re-armed
    // every second for as long as there was no signal.
    jest.useFakeTimers();
    try {
      setNavigatorOnline(false);
      onlineManager.setOnline(false);
      const send = mock(async () => {
        throw new TypeError("Failed to fetch");
      });
      const queue = makeQueue(send);
      queue.enqueue(tick);

      await act(async () => {
        renderWithIntl(
          <WriteQueueProvider queue={queue}>
            <Readout />
          </WriteQueueProvider>,
        );
      });
      const afterMount = send.mock.calls.length;

      for (let second = 0; second < 30; second += 1) {
        await act(async () => {
          jest.advanceTimersByTime(1_000);
        });
      }

      expect(send.mock.calls.length).toBe(afterMount);
      expect(queue.getState().pending).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
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
