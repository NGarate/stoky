"use client";

import { createContext, useContext, useMemo } from "react";
import { newOpId } from "@/lib/offline/ids";
import type { Replayable } from "@/lib/validations/idempotency";
import type { JSX, ReactNode } from "react";

/**
 * Who is composing changes on this device.
 *
 * Every replayable mutation carries the account that composed it, and the
 * server refuses a mismatch. Nothing on the client knew the account: there is
 * no `SessionProvider` in this application, and the dashboard layout is the
 * only place that has ever awaited `auth()`. So the layout hands it down from
 * there rather than a component reaching for a session it cannot see.
 *
 * The household comes with it. A change composed in one household must not
 * apply in another after someone moves — a real case once a change can sit in
 * a queue for days — and the queue in a later commit stamps every entry with
 * the household in force when it was made.
 */

export interface Composer {
  userId: string;
  householdId: string | null;
}

const ComposerContext = createContext<Composer | null>(null);

export function ComposerProvider({
  composer,
  children,
}: {
  composer: Composer;
  children: ReactNode;
}): JSX.Element {
  // The object identity would otherwise change on every render of the layout
  // and re-run every consumer, including the drain trigger.
  const value = useMemo(
    () => ({ userId: composer.userId, householdId: composer.householdId }),
    [composer.userId, composer.householdId],
  );

  return (
    <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>
  );
}

/** Throws rather than returning null: a write outside the shell is a bug. */
export function useComposer(): Composer {
  const composer = useContext(ComposerContext);
  if (!composer) {
    throw new Error(
      "useComposer must be used inside ComposerProvider — see (dashboard)/layout.tsx",
    );
  }
  return composer;
}

/**
 * A fresh envelope for one change.
 *
 * Called at the moment the change is made, not at render, so each tap gets its
 * own key — and so a *retry* of the same tap reuses the one already in the
 * mutation's variables rather than minting a second and applying twice.
 */
export function useEnvelope(): () => Replayable {
  const { userId } = useComposer();
  return useMemo(
    () => () => ({ idempotencyKey: newOpId(), composedByUserId: userId }),
    [userId],
  );
}
