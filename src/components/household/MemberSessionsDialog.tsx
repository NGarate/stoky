"use client";

import { TRPCClientError } from "@trpc/client";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ItemRow } from "@/components/ui/item-row";
import { useSessionName, type NamedSession } from "@/components/session/session-name";
import { formatDateTime } from "@/lib/dates";
import type { JSX, RefObject } from "react";

/** A member's session as `household.memberSessions` answers it. */
export interface MemberSession extends NamedSession {
  id: string;
  signedInAt: Date;
  lastUsedAt: Date;
  remembered: boolean;
}

/** Every reason ending a member's session can be refused, each with its own sentence. */
export type MemberSessionsRefusal = "notOwner" | "gone" | "failed";

/**
 * The server's refusal, in words the admin can act on.
 *
 * `FORBIDDEN` is an admin reaching for an owner's sessions, and the answer is
 * to ask an owner. `NOT_FOUND` is a session that had already ended — expired,
 * or ended from elsewhere — so the list is out of date rather than anything
 * being wrong. Everything else is "try again".
 */
export function memberSessionsRefusalOf(error: unknown): MemberSessionsRefusal {
  const code =
    error instanceof TRPCClientError ? (error.data?.code as string | undefined) : undefined;

  if (code === "FORBIDDEN") return "notOwner";
  if (code === "NOT_FOUND") return "gone";
  return "failed";
}

/**
 * A member's sessions, and a way for an admin to end one or every one — on
 * `/settings/people`, behind "Ver sus sesiones" (ASVS 5.0.0 7.4.5, PROGRESS
 * D145).
 *
 * **One, not only all.** Before this an admin could end every session a
 * member had and nothing less, so the lost kitchen tablet cost the member the
 * phone in their pocket too. The rows are the member's own **Tus
 * dispositivos**, named the same way (`useSessionName`) — the kitchen tablet
 * reads as the kitchen screen — in the compact density, because they sit in a
 * dialog and are read at a desk.
 *
 * **No password.** The owner confirmed on 2026-10-15 that an admin ending
 * somebody else's sessions is not re-asked; the server's guards are what
 * stand in for it. Nor is it asked twice: opening the dialog and pressing a
 * button that says what it ends are already two acts, and nothing is
 * destroyed — the member stays in the household and signs in again with
 * their password, which the description says before anything is pressed.
 *
 * `onEndOne` and `onEndAll` are the server calls. Each resolves when it is
 * done — the page then says so and reads the list again, or closes — and
 * rejects with the refusal, which is shown here, in the dialog where the
 * rows are, rather than in a snackbar that would outlive the reason.
 * `loadError` is the list's own refusal: an admin opening an owner's
 * sessions is told why there is nothing to show.
 */
export function MemberSessionsDialog({
  member,
  sessions,
  loadError,
  onEndOne,
  onEndAll,
  onClose,
  returnFocus,
}: {
  /** The person whose sessions these are; `null` keeps the dialog closed. */
  member: { id: string; name: string } | null;
  /** `undefined` while the list is being read. */
  sessions: readonly MemberSession[] | undefined;
  loadError: unknown;
  onEndOne: (session: { id: string; name: string }) => Promise<unknown>;
  onEndAll: () => Promise<unknown>;
  onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}): JSX.Element {
  const t = useTranslations("household");
  const tSecurity = useTranslations("security");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { nameOf, deviceName } = useSessionName();
  const [refusal, setRefusal] = useState<MemberSessionsRefusal | null>(null);
  /** The row being ended, `"all"`, or nobody. One at a time. */
  const [working, setWorking] = useState<string | null>(null);

  function close(): void {
    // Nothing of a refused attempt survives into the next person's dialog.
    setRefusal(null);
    onClose();
  }

  function run(which: string, call: () => Promise<unknown>): void {
    setRefusal(null);
    setWorking(which);
    // A chain rather than `try` around an await, which the React Compiler
    // cannot yet memoise.
    void call()
      .catch((error: unknown) => setRefusal(memberSessionsRefusalOf(error)))
      .finally(() => setWorking(null));
  }

  const sentence: Record<MemberSessionsRefusal, string> = {
    notOwner: t("revokeFailedNotOwner"),
    gone: t("memberSessionsGone"),
    failed: t("revokeFailed"),
  };
  const said = loadError
    ? memberSessionsRefusalOf(loadError) === "notOwner"
      ? t("revokeFailedNotOwner")
      : t("memberSessionsLoadFailed")
    : refusal
      ? sentence[refusal]
      : "";
  const name = member?.name ?? "";

  return (
    <Dialog
      description={t("memberSessionsBody")}
      footer={
        <>
          <Button onClick={close} type="button" variant="outline">
            {t("memberSessionsDone")}
          </Button>
          {/* Not `destructive`, as the inline confirmation it replaces was
              not: nothing is destroyed, and somebody who has lost a device
              should not be made to feel they are deleting the person. */}
          <Button
            disabled={working !== null || !sessions || sessions.length === 0}
            onClick={() => run("all", onEndAll)}
            type="button"
          >
            {working === "all" ? t("memberSessionsWorking") : t("memberSessionsEndAll")}
          </Button>
        </>
      }
      onClose={close}
      open={member !== null}
      returnFocus={returnFocus}
      title={t("memberSessionsTitle", { name })}
    >
      {/* Always mounted, `sr-only` when empty: a live region created at the
          moment it speaks is the case a screen reader may skip (WCAG 4.1.3). */}
      <p
        aria-live="polite"
        className={
          said
            ? "mb-3 rounded-xl border border-danger-foreground bg-danger px-4 py-3 text-sm text-danger-foreground"
            : "sr-only"
        }
        role="status"
      >
        {said}
      </p>

      {loadError ? null : !sessions ? (
        <p className="text-muted-foreground">{tCommon("loading")}</p>
      ) : sessions.length === 0 ? (
        <p className="text-muted-foreground">{t("memberSessionsNone", { name })}</p>
      ) : (
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
          {sessions.map((session) => {
            const device = nameOf(session);
            return (
              <ItemRow
                density="compact"
                key={session.id}
                meta={[
                  // The browser too, when the title is the screen: a second
                  // tablet that chose the same screen is told apart by it.
                  ...(session.screen
                    ? [{ label: tSecurity("metaDevice"), value: deviceName(session) }]
                    : []),
                  {
                    label: tSecurity("metaLastUsed"),
                    value: formatDateTime(locale, session.lastUsedAt),
                  },
                  {
                    label: tSecurity("metaSignedIn"),
                    value: formatDateTime(locale, session.signedInAt),
                  },
                  {
                    label: tSecurity("metaKind"),
                    value: session.remembered
                      ? tSecurity("kindRemembered")
                      : tSecurity("kindBrowser"),
                  },
                ]}
                title={device}
                actions={
                  <Button
                    // Every row has this button, so its name says which. It
                    // begins with the words on the screen, so speaking them
                    // still finds it (WCAG 2.5.3).
                    aria-label={t("memberSessionsEndOneNamed", { device })}
                    disabled={working !== null}
                    onClick={() => run(session.id, () => onEndOne({ id: session.id, name: device }))}
                    type="button"
                    variant="ghost"
                  >
                    {t("memberSessionsEndOne")}
                  </Button>
                }
              />
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
