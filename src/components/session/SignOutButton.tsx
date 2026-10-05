"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  useEndSession,
  EndSessionError,
  type EndSessionPhase,
} from "@/components/session/use-end-session";
import type { JSX } from "react";

/**
 * The control that did not exist.
 *
 * Until this, `signOut` was exported from `src/lib/auth.ts` and called
 * nowhere — so `queue.purgeAll` and the cached shell's purge were security
 * controls nothing could fire, and the only end-of-session signal in the
 * application was a redirect to `/login`.
 *
 * **It asks before it discards, and only when there is something to discard.**
 * A queue with unsent changes is somebody's shopping; signing out silently
 * would delete it. With nothing pending it says so and gets on with it, which
 * keeps §7 rule 3 — undo rather than confirm — for the case that is actually
 * routine.
 *
 * Three answers, because two would force a bad one: send them first, discard
 * them, or stay. "Send first" is offered even offline, where it will not
 * succeed — and that is deliberate: the attempt is what tells the person the
 * changes are still there rather than gone.
 */
export function SignOutButton(): JSX.Element {
  const t = useTranslations("session");
  const tOffline = useTranslations("offline");
  // No `before`: signing out of this device asks the server for nothing. The
  // purge sequence is shared with "end every session" — see `useEndSession`.
  const { pending, unsaved, working, leave, sendThenLeave } = useEndSession();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<EndSessionPhase | null>(null);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * The confirmation takes focus when it opens.
   *
   * Opening it unmounts the button that was focused, which sends focus to
   * `<body>`: a keyboard user loses their place, and a screen reader announces
   * nothing at all — so the panel that just asked a question is one nobody was
   * told about. `Dialog` solves this for modals with `panelRef.current.focus()`
   * on a `tabIndex={-1}` panel; this is the same technique for the inline
   * shape, which these controls use deliberately rather than as a modal.
   */
  useEffect(() => {
    if (asking) panelRef.current?.focus();
  }, [asking]);

  /**
   * These used to be `void leave()`, which discarded the rejection.
   *
   * Two of them are not theoretical. `sendThenLeave` now refuses when the queue
   * could not be emptied — a change still inside its undo window is enough —
   * and it used to purge those writes instead. And `signOutAction` is a POST,
   * so on the shared tablet this control exists for it rejects with the local
   * data already gone and the cookie still valid. Both need saying; an
   * unhandled rejection says it to the console.
   */
  async function run(sequence: () => Promise<void>): Promise<void> {
    setFailed(null);
    try {
      await sequence();
    } catch (error) {
      setFailed(error instanceof EndSessionError ? error.phase : "local");
    }
  }

  if (!asking) {
    return (
      <div>
        <Button
          onClick={() => setAsking(true)}
          type="button"
        >
          {t("signOut")}
        </Button>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("signOutShared")}
        </p>
      </div>
    );
  }

  return (
    <div
      aria-labelledby={titleId}
      className="rounded-lg border border-warn-foreground bg-warn p-4"
      ref={panelRef}
      role="group"
      tabIndex={-1}
    >
      <h3 className="font-semibold text-warn-foreground" id={titleId}>
        {t("signOutTitle")}
      </h3>
      <p className="mt-1 text-sm text-warn-foreground">
        {pending > 0
          ? t("signOutPending", { count: pending })
          : unsaved > 0
            ? null
            : t("signOutClean")}
        {/* Refused changes go with the rest, and sending first cannot save
            them — so they are said apart, and never as "nothing unsent". */}
        {unsaved > 0 ? (
          <>
            {pending > 0 ? " " : null}
            {t("endSessionUnsaved", { count: unsaved })}
          </>
        ) : null}
      </p>
      {unsaved > 0 ? (
        // Somewhere to look at them before they go, rather than a warning
        // with no way to act on it.
        <Button asChild className="px-0 text-warn-foreground" variant="link">
          <Link href="/settings/unsaved">{tOffline("seeUnsaved")}</Link>
        </Button>
      ) : null}

      {failed !== null ? (
        <p className="mt-2 text-sm font-semibold text-warn-foreground" role="alert">
          {t(failed === "unsent" ? "signOutFailedUnsent" : "signOutFailedAfter")}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {pending > 0 ? (
          <Button
            disabled={working}
            onClick={() => void run(sendThenLeave)}
            type="button"
          >
            {working ? t("signOutWorking") : t("signOutSendFirst")}
          </Button>
        ) : null}

        <Button
          disabled={working}
          onClick={() => void run(leave)}
          type="button"
        >
          {working
            ? t("signOutWorking")
            : pending > 0 || unsaved > 0
              ? t("signOutDiscard")
              : t("signOut")}
        </Button>

        <Button
          disabled={working}
          onClick={() => setAsking(false)}
          type="button"
        >
          {t("signOutCancel")}
        </Button>
      </div>
    </div>
  );
}
