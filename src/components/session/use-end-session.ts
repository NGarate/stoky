"use client";

import { useState } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { useWriteQueue } from "@/lib/offline/queue-context";
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
 * **`before` runs first and may refuse.** "End my sessions everywhere" is a
 * server write, and if it fails the person must stay signed in: purging and
 * redirecting anyway would show them the sign-in screen — which reads as
 * success — while every other device stayed live. So a throw from `before`
 * aborts with nothing discarded.
 *
 * **Which half failed is carried, not inferred.** A failure before the purge
 * and a failure after it are opposite facts — "nothing happened" against
 * "everything happened except signing out here" — and a caller that cannot
 * tell them apart will tell somebody the wrong one. Hence {@link EndSessionError}.
 */

/** Which half of the sequence failed. See {@link EndSessionError}. */
export type EndSessionPhase =
  /** The server write refused. Nothing local was touched. */
  | "server"
  /** The queue still holds writes nobody sent. Nothing local was touched. */
  | "unsent"
  /** The purge ran and sign-out did not. Local state is gone; the cookie is not. */
  | "local";

export class EndSessionError extends Error {
  readonly phase: EndSessionPhase;
  constructor(phase: EndSessionPhase, options?: { cause?: unknown }) {
    super(`end-session failed during the ${phase} phase`, options);
    this.name = "EndSessionError";
    this.phase = phase;
  }
}

export interface EndSession {
  /** Unsent writes that leaving would discard. */
  pending: number;
  /** True once a sequence has started, for disabling the controls. */
  working: boolean;
  /** Run `before`, purge this account's local state, and sign out. */
  leave: () => Promise<void>;
  /** Send the queue first, and refuse to leave if anything is still unsent. */
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
        throw new EndSessionError("server", { cause: error });
      }
    }

    try {
      // All three go before the redirect, because after it this component is
      // gone.
      purgeAll();
      forgetPersistedReads(userId);
      forgetCachedShell();
      await signOutAction();
    } catch (error) {
      // `signOutAction` is a POST, so it rejects on a dropped connection —
      // exactly the shared-tablet case these controls exist for. The purge has
      // already happened and the cookie has not been cleared, which is the
      // worst pairing available: the next person to pick the device up is still
      // signed in as the last one. Nothing here can undo that, so the least it
      // can do is stop pretending and let the caller say so.
      setWorking(false);
      throw new EndSessionError("local", { cause: error });
    }
  }

  async function sendThenLeave(): Promise<void> {
    setWorking(true);

    // **`flush()` resolving does not mean the queue was sent.** `drain()`
    // returns without sending when another drain is already in flight, when the
    // session has expired (`needs-signin`, which keeps everything on purpose),
    // and — the ordinary one — when the head of the queue is still inside its
    // undo window. Leaving on that promise alone purged exactly the changes the
    // person had just asked to send first, silently. So the answer is the count
    // that is left, and anything above zero refuses.
    const unsent = await flush();
    if (unsent > 0) {
      setWorking(false);
      throw new EndSessionError("unsent");
    }

    await leave();
  }

  return { pending: state.pending.length, working, leave, sendThenLeave };
}
