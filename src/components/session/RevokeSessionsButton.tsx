"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/trpc/client";
import {
  useEndSession,
  EndSessionError,
  type EndSessionPhase,
} from "@/components/session/use-end-session";
import type { JSX } from "react";

/**
 * "End my sessions everywhere" — the half of session revocation that belongs to
 * the account rather than to an administrator.
 *
 * `/settings/people` lets an admin end somebody else's sessions, which answers
 * a stolen kitchen tablet. It does not answer the case the owner raised first:
 * **your own** phone left on a train, at eleven at night, when the household's
 * admin is asleep. `auth.revokeMySessions` has existed since the admin panel
 * landed and nothing called it.
 *
 * **It signs you out here too, and says so.** Every session row the account
 * has is deleted, and the one rendering this screen is among them. A control that quietly ended the
 * session you are using would read as a crash, so the confirmation states it
 * before the fact rather than the redirect implying it after.
 *
 * **Separate from sign-out, and deliberately not merged into it.** They are
 * different acts with different costs — one ends a visit, the other makes
 * everyone in the household sign in again on every device they own — and a
 * single control with a checkbox would put the expensive one one mis-tap away
 * from the routine one.
 *
 * The unsent-writes question is identical, so the answer is identical and comes
 * from the same place: `useEndSession`, which also guarantees the ordering that
 * matters here. The server write happens first, and if it refuses nothing local
 * is discarded and the person stays signed in to be told why.
 */
export function RevokeSessionsButton(): JSX.Element {
  const t = useTranslations("session");
  const tOffline = useTranslations("offline");
  const revoke = api.auth.revokeMySessions.useMutation({
    // **`always`, not the client's `online` default.** Offline, an `online`
    // mutation is *paused* rather than rejected — `src/lib/offline/persist.ts`
    // says so in as many words — and `mutateAsync`'s promise then never
    // settles. This sequence awaits it, so the panel would sit at "Cerrando
    // sesiones..." with every button disabled, including cancel, showing no
    // failure and revoking nothing; and the mutation would fire unannounced
    // when the network came back. Somebody who has just lost a phone is owed a
    // refusal they can read and retry, not a spinner.
    networkMode: "always",
  });
  const { pending, unsaved, working, leave, sendThenLeave } = useEndSession(() =>
    revoke.mutateAsync(),
  );
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

  async function run(sequence: () => Promise<void>): Promise<void> {
    setFailed(null);
    try {
      await sequence();
    } catch (error) {
      // **Which half failed decides what is true**, and the two are opposites.
      // A `server` or `unsent` failure means nothing happened and the person is
      // still signed in everywhere; a `local` one means every session *was*
      // ended and only signing out here did not finish. One message for both
      // would tell half of the people who see it the reverse of their
      // situation — and on this control the reverse is "your lost phone is
      // still signed in".
      setFailed(error instanceof EndSessionError ? error.phase : "server");
    }
  }

  if (!asking) {
    return (
      <div>
        <Button onClick={() => setAsking(true)} type="button" variant="outline">
          {t("revokeAll")}
        </Button>
        <p className="mt-2 text-sm text-muted-foreground">{t("revokeAllWhy")}</p>
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
        {t("revokeAllTitle")}
      </h3>
      <p className="mt-1 text-sm text-warn-foreground">
        {pending > 0
          ? t("revokeAllPending", { count: pending })
          : unsaved > 0
            ? null
            : t("revokeAllClean")}
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
          {t(
            failed === "local"
              ? "revokeAllFailedAfter"
              : failed === "unsent"
                ? "revokeAllFailedUnsent"
                : "revokeAllFailed",
          )}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {pending > 0 ? (
          <Button
            disabled={working}
            onClick={() => void run(sendThenLeave)}
            type="button"
          >
            {working ? t("revokeAllWorking") : t("revokeAllSendFirst")}
          </Button>
        ) : null}

        {/* With changes waiting it deletes them too, and says so in colour. */}
        <Button
          disabled={working}
          onClick={() => void run(leave)}
          type="button"
          variant={pending > 0 || unsaved > 0 ? "destructive" : "default"}
        >
          {working
            ? t("revokeAllWorking")
            : pending > 0 || unsaved > 0
              ? t("revokeAllDiscard")
              : t("revokeAllConfirm")}
        </Button>

        <Button
          disabled={working}
          onClick={() => setAsking(false)}
          type="button"
          variant="outline"
        >
          {t("revokeAllCancel")}
        </Button>
      </div>
    </div>
  );
}
