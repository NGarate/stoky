"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { JSX } from "react";

/**
 * Keeps an active session alive, and warns before an idle one ends.
 *
 * WCAG 2.1 **2.2.6 Timeouts** (AAA): a user must be warned of an inactivity
 * duration that could cause data loss. This application had neither half — the
 * session expired fifteen minutes after sign-in regardless of what the person
 * was doing, and nothing said so. Half a filled-in receipt review is exactly
 * the data 2.2.6 is about.
 *
 * Two behaviours, and they are deliberately different:
 *
 * - **Activity refreshes silently.** A pointer or a key, throttled to once
 *   every four minutes, asks the server for the session; Auth.js re-issues the
 *   token because `updateAge` has passed. Someone who is using
 *   the application never sees this component at all, which is the point — a
 *   warning that fires while you are typing is a nuisance, not an
 *   accessibility feature.
 * - **Inactivity warns, out loud.** Two minutes before expiry a live region
 *   announces how long is left and offers to stay signed in. It is
 *   `role="alert"`, so a screen reader says it without anyone having to look,
 *   and it does **not** take focus: the warning arrives when the person is
 *   already away from the keyboard, and stealing focus would move a caret that
 *   someone may be about to come back to.
 */

/** How long before expiry the warning appears. */
const WARN_BEFORE_MS = 2 * 60 * 1000;

/**
 * The shortest gap between two silent refreshes.
 *
 * Just under the five minutes of `updateAge`, so continuous use costs at most
 * one extra request every four minutes and every one of them actually moves
 * the expiry — a shorter throttle would mostly ask the server to re-issue a
 * token it had just issued.
 */
const REFRESH_THROTTLE_MS = 4 * 60 * 1000;

/** How often the remaining time is recomputed. */
const TICK_MS = 15 * 1000;

interface SessionKeepAliveProps {
  /** `session.expires`, as the server rendered it. */
  expiresAt: string;
  /** Injected by the tests; the browser's own fetch otherwise. */
  fetcher?: typeof fetch;
}

export function SessionKeepAlive({
  expiresAt,
  fetcher,
}: SessionKeepAliveProps): JSX.Element | null {
  const t = useTranslations("session");
  const [expiry, setExpiry] = useState(() => new Date(expiresAt).getTime());
  const [remainingMs, setRemainingMs] = useState(
    () => new Date(expiresAt).getTime() - Date.now(),
  );
  const lastRefresh = useRef(0);
  const refreshing = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (refreshing.current) return;
    refreshing.current = true;
    // Same compiler limitation as the auth forms: a `try`/`catch` around an
    // await inside this callback stops the component being memoised. The catch
    // stays, because a failed session refresh must not take the timer with it.
    // react-doctor-disable-next-line react-hooks-js/todo
    try {
      const request = fetcher ?? fetch;
      const response = await request("/api/auth/session", { cache: "no-store" });
      const session = (await response.json()) as { expires?: string } | null;
      if (session?.expires) {
        setExpiry(new Date(session.expires).getTime());
        setRemainingMs(new Date(session.expires).getTime() - Date.now());
      }
      lastRefresh.current = Date.now();
    } catch {
      // A refresh that fails changes nothing: the session expires when it was
      // always going to, and the warning below still appears. Reporting a
      // network blip as a session problem would be a lie with a scary shape.
    } finally {
      refreshing.current = false;
    }
  }, [fetcher]);

  // The countdown. Recomputed rather than decremented, because a laptop that
  // slept through the timer would otherwise think it still had time.
  useEffect(() => {
    const tick = () => setRemainingMs(expiry - Date.now());
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [expiry]);

  // Activity slides the session, quietly.
  useEffect(() => {
    const onActivity = () => {
      if (Date.now() - lastRefresh.current < REFRESH_THROTTLE_MS) return;
      void refresh();
    };

    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [refresh]);

  if (remainingMs > WARN_BEFORE_MS) return null;

  const minutesLeft = Math.max(0, Math.ceil(remainingMs / 60000));
  const expired = remainingMs <= 0;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t border-warn-foreground bg-warn px-4 py-3 pb-28 md:pb-3"
      role="alert"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-warn-foreground">
          {expired ? t("expired") : t("expiringIn", { minutes: minutesLeft })}
        </p>
        <Button
          className="sm:w-auto"
          onClick={() => void refresh()}
          type="button"
        >
          {t("staySignedIn")}
        </Button>
      </div>
    </div>
  );
}
