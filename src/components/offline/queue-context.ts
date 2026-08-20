"use client";

import { createContext, useContext } from "react";
import type {
  EnqueueInput,
  EnqueueResult,
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
  discard: (id: string) => void;
  /** Send everything now and resolve when the queue has settled. */
  flush: () => Promise<void>;
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
