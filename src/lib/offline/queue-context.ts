"use client";

import { createContext, useContext } from "react";
import type {
  EnqueueInput,
  EnqueueResult,
  FailedOp,
  QueueState,
} from "@/lib/offline/queue";

/**
 * The queue as the rest of the interface sees it.
 *
 * Kept apart from `WriteQueueProvider` deliberately. Bun's `mock.module`
 * replaces a module for the whole test process, so a test that mocked the hook
 * to render one component also replaced `WriteQueueProvider` for every other
 * file — which turned the provider into `undefined` in the one suite that
 * renders the real thing. Splitting the hook out means mocking it cannot reach
 * the provider.
 *
 * It is also the shape this should have had anyway: a consumer that needs the
 * hook has no business importing the provider.
 *
 * Lives in lib/ rather than components/offline/ because ui/ primitives (the
 * snackbar's undo) consume it, and a design-system primitive must not depend
 * on a feature slice — lib is the layer both may stand on.
 */
export interface WriteQueueValue {
  state: QueueState;
  enqueue: (op: EnqueueInput) => EnqueueResult;
  drain: () => void;
  /** Take back a change that has not been sent. False when it is too late. */
  cancel: (id: string) => boolean;
  /**
   * How long that change can still be taken back, in milliseconds. Zero when
   * it cannot be, for any reason — so a positive number is the whole licence
   * an undo affordance needs to offer itself, and for how long.
   */
  holdRemainingMs: (id: string) => number;
  retry: (id: string) => void;
  /** Give up on a failed change. Returns it, so `restore` can undo that. */
  discard: (id: string) => FailedOp | null;
  /** Put a discarded change back where it was. */
  restore: (op: FailedOp) => void;
  /**
   * Send what can be sent, and resolve with **how many writes are still
   * unsent**.
   *
   * The count is the whole point, and this used to resolve with nothing. A
   * drain returns without sending in three ordinary states — another drain is
   * already in flight, the session has expired (`needs-signin` keeps
   * everything deliberately), or the head is still inside its undo window — so
   * "the promise resolved" and "the queue is empty" are different facts. The
   * one caller treated them as the same and purged unsent changes somebody had
   * just asked it to send.
   */
  flush: () => Promise<number>;
  /** Take this account's changes off the device. Sign-out only. */
  purgeAll: () => void;
}

export const WriteQueueContext = createContext<WriteQueueValue | null>(null);

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
