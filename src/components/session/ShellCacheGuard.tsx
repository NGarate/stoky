"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { forgetCachedShell, reconcileUser } from "@/lib/sw/register";

const STORAGE_KEY = "stoky.shell.user";

/**
 * Drop the cached shell when the account behind it changes.
 *
 * The shell is an authenticated document, kept so the app opens without a
 * signal. Four things make that defensible and this is one of them: it is
 * purged on a change of account, and on reaching `/login`.
 *
 * `/login` matters more than it looks. **There is no sign-out control in this
 * application** — `signOut` is exported and called nowhere — so a redirect to
 * `/login` is the only end-of-session signal that exists.
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
