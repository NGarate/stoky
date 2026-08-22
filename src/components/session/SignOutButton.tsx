"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth/actions";
import { useWriteQueue } from "@/components/offline/queue-context";
import { forgetCachedShell } from "@/lib/sw/register";
import { forgetPersistedReads } from "@/lib/offline/persist";
import { useComposer } from "@/components/offline/Composer";
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
  const { state, flush, purgeAll } = useWriteQueue();
  const { userId } = useComposer();
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const titleId = useId();

  const pending = state.pending.length;

  async function leave(): Promise<void> {
    setWorking(true);
    // The queue and the cached shell belong to this account. Both go before
    // the redirect, because after it this component no longer exists.
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
      role="group"
    >
      <h3 className="font-semibold text-warn-foreground" id={titleId}>
        {t("signOutTitle")}
      </h3>
      <p className="mt-1 text-sm text-warn-foreground">
        {pending > 0 ? t("signOutPending", { count: pending }) : t("signOutClean")}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {pending > 0 ? (
          <Button
            disabled={working}
            onClick={() => void sendThenLeave()}
            type="button"
          >
            {working ? t("signOutWorking") : t("signOutSendFirst")}
          </Button>
        ) : null}

        <Button
          disabled={working}
          onClick={() => void leave()}
          type="button"
        >
          {working
            ? t("signOutWorking")
            : pending > 0
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
