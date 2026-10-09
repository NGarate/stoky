"use client";

import { onlineManager } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { api } from "@/lib/trpc/client";
import { useComposer } from "./Composer";
import { WriteQueueContext, type WriteQueueValue } from "@/lib/offline/queue-context";
import { openWriteQueue, type WriteQueue } from "@/lib/offline/queue";
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

  /**
   * The household as the server reports it, not as the token remembers it.
   *
   * The token is not re-issued when an account creates or joins a household,
   * so the composer's `householdId` can be null — or the old one — for the
   * rest of the session, and every change composed meanwhile was stamped with
   * it. `auth.me` reads the account row, and `CreateHousehold` invalidates
   * every query on success, so this follows the household as it changes.
   */
  const me = api.auth.me.useQuery(undefined, { retry: false });
  const liveHousehold = me.data?.household?.id;
  useEffect(() => {
    if (liveHousehold) queue.setHousehold(liveHousehold);
  }, [liveHousehold, queue]);

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
      void queue.drain().then((sent) => {
        // Only when something was sent. A drain that sent nothing has changed
        // nothing on the server, and refetching then is a request every
        // trigger would make for no reason.
        //
        // The count comes from the drain rather than from comparing the
        // pending length before and after: one change sent while another was
        // queued leaves the length where it was, and the screen kept its
        // answer from before the write that just landed.
        if (sent > 0) void invalidate.current();
      });
    },
    [queue],
  );

  useEffect(() => {
    // What is on the device is loaded here rather than when the queue is
    // built: reading storage during render makes the server's empty queue and
    // the client's restored one disagree, and React throws the tree away.
    queue.hydrate();
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
  }, [drain, queue]);

  /**
   * The retry timer, armed only while something is waiting.
   *
   * It **re-arms itself** rather than depending on the pending count changing.
   * A failed attempt leaves the count exactly as it was, so an effect keyed on
   * that fires once and never again — the queue then sits there until
   * something else happens to trigger a drain, which on a phone left alone is
   * never. Found in a browser, where a change made against a blocked server
   * was still unsent thirty seconds later.
   */
  const pendingCount = state.pending.length;
  const needsSignin = state.status === "needs-signin";
  /**
   * And only while there is a connection to retry against.
   *
   * A transport failure costs no strike — that is right, a phone in a tunnel
   * has not been refused — so `attempts` stays at zero and the backoff stays
   * at its first, sub-second step. Offline, this timer therefore fired, failed
   * and re-armed under a second, for as long as the phone had no signal:
   * battery, and a localStorage write on every lap. The connection coming
   * back is already a trigger (the subscription above), and this is a
   * dependency so the timer re-arms then too.
   */
  const online = useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  );
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    if (pendingCount === 0 || needsSignin || !online) return;

    const delay = queue.nextDelayMs();
    if (delay === null) return;

    // One timer, cleared by the cleanup that created it. Re-arming happens by
    // bumping `retryTick`, which re-runs this effect — rather than by a
    // nested `setTimeout` whose cleanup a reader (and a linter) has to reason
    // about.
    const id = setTimeout(() => {
      drain();
      setRetryTick((tick) => tick + 1);
    }, Math.max(delay, 250));

    return () => clearTimeout(id);
  }, [pendingCount, needsSignin, online, retryTick, queue, drain]);

  const value = useMemo<WriteQueueValue>(
    () => ({
      state,
      enqueue: (op) => {
        const result = queue.enqueue(op);
        if (result.ok) drain();
        return result;
      },
      drain,
      cancel: (id) => queue.cancel(id),
      holdRemainingMs: (id) => queue.holdRemainingMs(id),
      retry: (id) => {
        queue.retry(id);
        drain();
      },
      discard: (id) => queue.discard(id),
      restore: (op) => queue.restore(op),
      // Read back from the queue rather than from `state`: `state` is this
      // render's snapshot and the drain just changed it.
      flush: async () => {
        await queue.drain();
        return queue.getState().pending.length;
      },
      purgeAll: () => queue.purgeAll(),
    }),
    [state, queue, drain],
  );

  return (
    <WriteQueueContext.Provider value={value}>
      {children}
    </WriteQueueContext.Provider>
  );
}
