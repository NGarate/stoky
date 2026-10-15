"use client";

import { useOnline } from "@/lib/useOnline";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { readSessionExpiry, type SessionExpiry } from "@/lib/auth/client";
import type { DeadlineKind } from "@/lib/auth/session-policy";
import type { JSX } from "react";

/**
 * Keeps an active session alive, and warns before an idle one ends.
 *
 * A remembered session (the login form's box, D141) has ninety days ahead of
 * it, so the warning below never appears in a day's use; the activity refresh
 * still asks, and only reads it (`auth.session`).
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
 *   every four minutes, asks `auth.session`, which moves the session's expiry
 *   fifteen minutes on — up to the day's limit from the sign-in and never past
 *   it. It is the only thing that moves it: a background read is not somebody
 *   at the screen (`src/lib/auth/session-policy.ts`). Someone who is using the
 *   application never sees this component until that limit, which is the
 *   point — a warning that fires while you are typing is a nuisance, not an
 *   accessibility feature.
 * - **The deadline warns, out loud.** Two minutes before expiry a live region
 *   announces how long is left. It is `role="alert"`, so a screen reader says
 *   it without anyone having to look, and it does **not** take focus: the
 *   warning arrives when the person is already away from the keyboard, and
 *   stealing focus would move a caret that someone may be about to come back
 *   to.
 *
 * **Which deadline it is decides what the warning says.** An idle deadline
 * (`kind: "idle"`) names the inactivity and offers to stay signed in, because
 * pressing the button moves it. The day's limit (`kind: "cap"`) names the limit
 * and offers nothing: no request can extend it, and a button that answers with
 * the same countdown tells the person they did something when they did not.
 * The server says which (`deadlineKind`), on the first render and on every
 * refresh, so a session that slides into its last fifteen minutes changes its
 * warning without a reload.
 */

/** How long before expiry the warning appears. */
const WARN_BEFORE_MS = 2 * 60 * 1000;

/**
 * The shortest gap between two silent refreshes.
 *
 * Continuous use costs at most one extra request every four minutes, which
 * keeps an active session well inside its fifteen idle minutes; a shorter
 * throttle would only spend requests moving the expiry a little further each
 * time.
 *
 * It keeps asking at the day's limit, where the expiry no longer moves: the
 * answer still says the session is live, and the slide's write is what dates
 * the row's last use for the ten-session cap (`src/lib/auth/sign-in-tidy.ts`).
 */
const REFRESH_THROTTLE_MS = 4 * 60 * 1000;

/** How often the remaining time is recomputed. */
const TICK_MS = 15 * 1000;

interface SessionKeepAliveProps {
  /** `session.expires`, as the server rendered it. */
  expiresAt: string;
  /** `session.expiresKind`: which deadline `expiresAt` is. */
  kind: DeadlineKind;
  /**
   * Reads, and so slides, the session's expiry. Injected by the tests;
   * `readSessionExpiry` (`src/lib/auth/client.ts`) otherwise.
   */
  readExpiry?: () => Promise<SessionExpiry | null>;
}

export function SessionKeepAlive({
  expiresAt,
  kind: renderedKind,
  readExpiry = readSessionExpiry,
}: SessionKeepAliveProps): JSX.Element | null {
  const t = useTranslations("session");
  const online = useOnline();
  const [expiry, setExpiry] = useState(() => new Date(expiresAt).getTime());
  const [kind, setKind] = useState<DeadlineKind>(renderedKind);
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
      const session = await readExpiry();
      if (session) {
        setExpiry(new Date(session.expires).getTime());
        setKind(session.kind);
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
  }, [readExpiry]);

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

  /**
   * Say nothing when there is no network.
   *
   * A shell restored from the service worker's cache carries a stale
   * `session.expires`, rendered as a prop by the dashboard layout. Offline,
   * `auth.session` is passed through and fails, so the session cannot be
   * refreshed — and greeting someone with a countdown they can do nothing
   * about is an interruption with no action attached, which is the failure
   * §7 rule 3 is about.
   *
   * The hook is read before the early return so it is called unconditionally,
   * which the rules of hooks require.
   */
  if (!online) return null;

  if (remainingMs > WARN_BEFORE_MS) return null;

  const minutesLeft = Math.max(0, Math.ceil(remainingMs / 60000));
  const expired = remainingMs <= 0;
  const atLimit = kind === "cap";
  const message = atLimit
    ? expired
      ? t("capReached")
      : t("capIn", { minutes: minutesLeft })
    : expired
      ? t("expired")
      : t("expiringIn", { minutes: minutesLeft });

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t border-warn-foreground bg-warn px-4 py-3 pb-28 md:pb-3"
      role="alert"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-warn-foreground">{message}</p>
        {atLimit ? null : (
          <Button
            className="sm:w-auto"
            onClick={() => void refresh()}
            type="button"
          >
            {t("staySignedIn")}
          </Button>
        )}
      </div>
    </div>
  );
}
