"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  forgetPersistedReads,
  forgetPersistedReadsExcept,
} from "@/lib/offline/persist";
import { forgetCachedShell, reconcileUser } from "@/lib/sw/register";

const STORAGE_KEY = "stoky.shell.user";

/**
 * Drop what the device keeps for an account once that account is gone.
 *
 * The shell is an authenticated document, kept so the app opens without a
 * signal. Four things make that defensible and this is one of them: it is
 * purged on a change of account, and on reaching `/login`.
 *
 * `/login` matters more than it looks. Signing out (`useEndSession`, behind
 * **Cerrar sesión** and every control that ends this account's sessions from
 * here) purges this device itself before it leaves — but most sessions do not
 * end that way. An idle token expiring, the thirty-day ceiling, or another
 * device ending this account's sessions all end it on the server, and the
 * browser only finds out by being sent to `/login`. Nothing runs on the client
 * before that redirect, so this is the only cleanup those endings get.
 *
 * **The previous account's saved reads go too**, on `/login` and on a change
 * of account: the allowlisted queries `ReadCache` keeps in `localStorage`
 * under that account's key — and so does any other account's copy but the one
 * signed in now, which is what clears a device updated after a copy was
 * already orphaned. TanStack removes them only when the *same* account
 * restores them past their age, so an account that never signs in here again
 * left its inventory and shopping lists readable on the device for good
 * (security review 2026-10-12). The write queue is deliberately kept: an
 * expired session is told to sign in again, and its unsent changes are what it
 * signs in to send.
 *
 * The previous id is kept in `localStorage` rather than in React state,
 * because the whole point is to notice across a full page load.
 *
 * **The queries held in memory go too.** The query client lives in the root
 * provider and survives every soft navigation, so an expired session that
 * lands here and the next account that signs in from here would otherwise
 * share it: the second person was shown the first one's inventory, and their
 * persister saved it under their own key. `/login` empties it outright —
 * nothing on it reads household data. Inside the dashboard a change of
 * account *resets* rather than clears, because the new account's screens are
 * already mounted and must refetch rather than be orphaned.
 */
export function ShellCacheGuard({ userId }: { userId: string | null }): null {
  const applied = useRef(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (applied.current) return;
    applied.current = true;

    let previous: string | null = null;
    try {
      previous = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      previous = null;
    }

    if (reconcileUser(previous, userId)) {
      forgetCachedShell();
    }

    if (previous !== null && previous !== userId) {
      // By name, not only through the sweep below: a save still on its
      // throttle has not written the key yet, so the sweep cannot see it —
      // naming the account is what makes the persister refuse it when it lands.
      forgetPersistedReads(previous);
    }
    // And any other account's but this one's: copies left by an install that
    // predates this guard forgetting them, whose owner nobody recorded.
    forgetPersistedReadsExcept(userId);

    if (userId === null) {
      queryClient.clear();
    } else if (previous !== null && previous !== userId) {
      void queryClient.resetQueries();
    }

    try {
      if (userId === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, userId);
    } catch {
      // A blocked storage costs a redundant purge, not correctness.
    }
  }, [queryClient, userId]);

  return null;
}
