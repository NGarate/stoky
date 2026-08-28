"use client";

import { useState } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { useWriteQueue } from "@/components/offline/queue-context";
import { forgetCachedShell } from "@/lib/sw/register";
import { forgetPersistedReads } from "@/lib/offline/persist";
import { useComposer } from "@/components/offline/Composer";

/**
 * Ending a session, and the three things that have to go with it.
 *
 * The write queue, the persisted reads and the cached shell all belong to the
 * account that is leaving. Until `SignOutButton` existed they were security
 * controls nothing could fire; there are two callers now — signing out of this
 * device, and ending every session everywhere — and the sequence is here rather
 * than copied because a second copy is how one of the three gets forgotten.
 *
 * **`before` runs first and may refuse.** That ordering is the whole reason
 * this takes a callback rather than the callers doing their own work and then
 * calling a `leave()`. "End my sessions everywhere" is a server write, and if
 * it fails the person must stay signed in: purging and redirecting anyway would
 * show them the sign-in screen — which reads as success — while every other
 * device stayed live. So a throw from `before` aborts the whole sequence with
 * nothing discarded, and the caller is left to say why.
 */
export interface EndSession {
  /** Unsent writes that leaving would discard. */
  pending: number;
  /** True once a sequence has started, for disabling the controls. */
  working: boolean;
  /** Run `before`, purge this account's local state, and sign out. */
  leave: () => Promise<void>;
  /** Flush the queue first. Offered even offline — see `SignOutButton`. */
  sendThenLeave: () => Promise<void>;
}

export function useEndSession(before?: () => Promise<unknown>): EndSession {
  const { state, flush, purgeAll } = useWriteQueue();
  const { userId } = useComposer();
  const [working, setWorking] = useState(false);

  async function leave(): Promise<void> {
    setWorking(true);

    if (before !== undefined) {
      try {
        await before();
      } catch (error) {
        // Nothing has been discarded at this point, and that is the guarantee:
        // the caller can report the failure to somebody who is still signed in.
        setWorking(false);
        throw error;
      }
    }

    // Both go before the redirect, because after it this component is gone.
    purgeAll();
    forgetPersistedReads(userId);
    forgetCachedShell();
    await signOutAction();
  }

  async function sendThenLeave(): Promise<void> {
    setWorking(true);
    await flush();
    await leave();
  }

  return { pending: state.pending.length, working, leave, sendThenLeave };
}
