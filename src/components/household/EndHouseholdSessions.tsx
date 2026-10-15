"use client";

import { TRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ReauthDialog, type ReauthAction } from "@/components/session/ReauthDialog";
import { EndSessionError, useEndSession } from "@/components/session/use-end-session";
import { api } from "@/lib/trpc/client";
import type { JSX } from "react";

/**
 * **Cerrar todas las sesiones del hogar**: an owner signs every member out of
 * every device, themselves included (ASVS 5.0.0 7.4.5, PROGRESS D147). The
 * server half is `household.endHouseholdSessions`.
 *
 * The people page renders it for owners only; the server refuses anybody
 * else whatever the screen shows.
 *
 * **It asks for the password** (`ReauthDialog`), because it ends the owner's
 * own sessions as well, and a session somebody else is holding must not be
 * able to sign the household out. That is the difference from an admin
 * ending one member's (`MemberSessionsDialog`, D145), which is not re-asked.
 *
 * **It always ends the session rendering it**, so it runs `useEndSession`
 * with the server call as its `before`, exactly as **Cerrar todas** on **Tus
 * dispositivos** does: the server first, then the queue, the persisted reads
 * and the cached shell, then the redirect; a refusal discards nothing.
 * Changes still waiting to be sent are offered the same two answers —
 * send first, or discard.
 */
export function EndHouseholdSessions(): JSX.Element {
  const t = useTranslations("household");
  const tSecurity = useTranslations("security");
  const tSession = useTranslations("session");
  const tOffline = useTranslations("offline");

  const endHousehold = api.household.endHouseholdSessions.useMutation({
    // `always`, for `DeviceList`'s reason: offline, an `online` mutation
    // pauses, its promise never settles, and the dialog would sit with every
    // button disabled and nothing saying why.
    networkMode: "always",
  });

  /**
   * The password the sequence's `before` sends. `useEndSession` takes its
   * `before` when the component renders, and the password exists only once
   * the dialog is submitted, so the sequence reads it from here as it runs.
   */
  const password = useRef<string | null>(null);
  const { pending, unsaved, leave, sendThenLeave } = useEndSession(() => {
    const currentPassword = password.current;
    if (currentPassword === null) throw new Error("no password to confirm with");
    return endHousehold.mutateAsync({ currentPassword });
  });

  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);

  async function submit(currentPassword: string, actionId: string): Promise<void> {
    // The page goes to /login when this resolves; nothing after it runs.
    // Cleared however it ends, so the password does not outlive the attempt.
    password.current = currentPassword;
    await (actionId === "send" ? sendThenLeave() : leave()).finally(() => {
      password.current = null;
    });
  }

  /**
   * The refusals only this control understands. `unsent` means nothing
   * happened; `local` means every session was ended and only leaving this
   * device did not finish. `FORBIDDEN` is somebody who stopped being an owner
   * after the page was drawn. A wrong password or a spent budget the dialog
   * words itself.
   */
  function describe(error: unknown): string | null {
    if (error instanceof EndSessionError && error.phase === "unsent") {
      return tSecurity("endFailedUnsent");
    }
    if (error instanceof EndSessionError && error.phase === "local") {
      return t("endAllHouseholdFailedAfter");
    }
    const refusal = error instanceof EndSessionError ? error.cause : error;
    const code =
      refusal instanceof TRPCClientError ? (refusal.data?.code as string | undefined) : undefined;
    return code === "FORBIDDEN" ? t("endAllHouseholdNotOwner") : null;
  }

  const actions: [ReauthAction, ...ReauthAction[]] =
    pending > 0
      ? [
          { id: "send", label: tSecurity("endSendFirst") },
          { id: "discard", label: tSecurity("endDiscard"), variant: "destructive" },
        ]
      : [{ id: "leave", label: t("endAllHouseholdButton"), variant: "destructive" }];

  return (
    <>
      <p className="text-sm text-muted-foreground">{t("endAllHouseholdIntro")}</p>
      <Button
        className="mt-3"
        onClick={(event) => {
          opener.current = event.currentTarget;
          setOpen(true);
        }}
        type="button"
        variant="destructive"
      >
        {t("endAllHouseholdButton")}
      </Button>

      <ReauthDialog
        actions={actions}
        describe={describe}
        description={t("endAllHouseholdDialogBody")}
        notice={
          pending > 0 || unsaved > 0 ? (
            <div className="mb-3 rounded border border-warn-foreground bg-warn p-3 text-sm text-warn-foreground">
              <p>
                {pending > 0 ? tSecurity("endPending", { count: pending }) : null}
                {/* Refused changes go with the rest, and sending first cannot
                    save them — so they are said apart. */}
                {unsaved > 0 ? (
                  <>
                    {pending > 0 ? " " : null}
                    {tSession("endSessionUnsaved", { count: unsaved })}
                  </>
                ) : null}
              </p>
              {unsaved > 0 ? (
                <Button asChild className="px-0 text-warn-foreground" variant="link">
                  <Link href="/settings/unsaved">{tOffline("seeUnsaved")}</Link>
                </Button>
              ) : null}
            </div>
          ) : null
        }
        onClose={() => setOpen(false)}
        onSubmit={submit}
        open={open}
        returnFocus={opener}
        title={t("endAllHouseholdDialogTitle")}
        tone="danger"
      />
    </>
  );
}
