"use client";

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
 */
export function ShellCacheGuard({ userId }: { userId: string | null }): null {
  const applied = useRef(false);

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

    try {
      if (userId === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, userId);
    } catch {
      // A blocked storage costs a redundant purge, not correctness.
    }
  }, [userId]);

  return null;
}
