"use client";

import { onlineManager } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { api } from "@/lib/trpc/client";
import { useComposer } from "./Composer";
import { openWriteQueue, type EnqueueInput, type EnqueueResult, type QueueState, type WriteQueue } from "@/lib/offline/queue";
import { createOperationSender } from "@/lib/offline/sender";
import type { JSX, ReactNode } from "react";

/**
 * The queue, mounted, and the things that make it drain.
 *
 * The store is `zustand/vanilla`, so this file is the whole of its React
 * binding: one `useStore` call, plus the triggers. Everything worth testing
 * about the queue itself is tested without a renderer.
 *
 * **Every trigger is here rather than scattered**, because a drain fired from
 * two places at once is the thing the single-flight guard has to defend
 * against, and a guard is easier to trust when the callers are in one file:
 *
 * - the connection coming back, through `onlineManager` rather than a bare
 *   `online` listener, so it agrees with what the query client believes;
 * - the tab becoming visible, which is how a phone taken out of a pocket
 *   reports for duty;
 * - the window regaining focus;
 * - a timer, armed **only while something is waiting**, so an idle app sets no
 *   timers at all;
 * - enqueueing, so a change made online goes immediately and there is no
 *   second code path for "online" versus "offline".
 *
 * The query cache is invalidated **once per settled drain**, not once per
 * operation. Forty queued changes should cost one refetch, not forty.
 */

interface WriteQueueValue {
  state: QueueState;
  enqueue: (op: EnqueueInput) => EnqueueResult;
  drain: () => void;
  retry: (id: string) => void;
  discard: (id: string) => void;
}

const WriteQueueContext = createContext<WriteQueueValue | null>(null);

export function WriteQueueProvider({
  children,
  queue: injected,
}: {
  children: ReactNode;
  /** Supplied by tests. Production builds one from the session. */
  queue?: WriteQueue;
}): JSX.Element {
  const { userId, householdId } = useComposer();
  const utils = api.useUtils();

  const [queue] = useState<WriteQueue>(
    () =>
      injected ??
      openWriteQueue({
        userId,
        householdId: householdId ?? "",
        send: createOperationSender(userId),
      }),
  );

  const state = useStore(queue.store);

  // Held in a ref so the effects below do not re-run when the cache helpers
  // change identity, which they do on every render. Assigned in an effect
  // rather than during render: a ref written while rendering is a Rules of
  // React violation, it stops the compiler optimising this component, and it
  // is wrong under a re-render React decides to throw away.
  const invalidate = useRef(utils.invalidate);
  useEffect(() => {
    invalidate.current = utils.invalidate;
  });

  const drain = useMemo(
    () => () => {
      // Single-flight is the queue's, not this component's. It returns
      // immediately when a drain is already running, so a second guard here
      // would be a second thing to keep in step for one property — and the
      // one that rots is always the copy.
      const before = queue.getState().pending.length;

      void queue.drain().then(() => {
        // Only when something actually left. A drain that sent nothing has
        // changed nothing on the server, and refetching then is a request
        // every trigger would make for no reason.
        if (queue.getState().pending.length !== before) {
          void invalidate.current();
        }
      });
    },
    [queue],
  );

  useEffect(() => {
    drain();

    const unsubscribe = onlineManager.subscribe((online) => {
      if (online) drain();
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") drain();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", drain);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", drain);
    };
  }, [drain]);

  // Armed only while something is waiting, so an idle app holds no timer.
  const pendingCount = state.pending.length;
  const needsSignin = state.status === "needs-signin";
  useEffect(() => {
    if (pendingCount === 0 || needsSignin) return;

    const delay = queue.nextDelayMs();
    if (delay === null) return;

    const timer = setTimeout(drain, delay);
    return () => clearTimeout(timer);
  }, [pendingCount, needsSignin, queue, drain]);

  const value = useMemo<WriteQueueValue>(
    () => ({
      state,
      enqueue: (op) => {
        const result = queue.enqueue(op);
        if (result.ok) drain();
        return result;
      },
      drain,
      retry: (id) => {
        queue.retry(id);
        drain();
      },
      discard: (id) => queue.discard(id),
    }),
    [state, queue, drain],
  );

  return (
    <WriteQueueContext.Provider value={value}>
      {children}
    </WriteQueueContext.Provider>
  );
}

/** Throws rather than returning null: a write outside the shell is a bug. */
export function useWriteQueue(): WriteQueueValue {
  const value = useContext(WriteQueueContext);
  if (!value) {
    throw new Error(
      "useWriteQueue must be used inside WriteQueueProvider — see (dashboard)/layout.tsx",
    );
  }
  return value;
}
