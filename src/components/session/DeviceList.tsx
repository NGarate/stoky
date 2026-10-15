"use client";

import { TRPCClientError } from "@trpc/client";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ItemRow } from "@/components/ui/item-row";
import { useSnackbar } from "@/components/ui/snackbar";
import { SectionState } from "@/components/household/RouteState";
import { ReauthDialog, type ReauthAction } from "@/components/session/ReauthDialog";
import { EndSessionError, useEndSession } from "@/components/session/use-end-session";
import { api } from "@/lib/trpc/client";
import { formatDateTime } from "@/lib/dates";
import type { EndSessionsInput } from "@/lib/validations/auth";
// The shape the procedure declares, rather than a hand-written copy of it: a
// type-only import, erased before anything reaches the browser.
import type { AppRouter } from "@/server/trpc/router";
import type { inferRouterOutputs } from "@trpc/server";
import type { JSX } from "react";

type Listed = inferRouterOutputs<AppRouter>["auth"]["listSessions"][number];

/** What the open dialog is about to end. `null` keeps it closed. */
type Target =
  | { scope: "one"; session: Listed; name: string }
  | { scope: "others" }
  | { scope: "all" };

/**
 * Whether ending `target` ends the session rendering this screen — and so
 * must go through `useEndSession`, which purges this device before it leaves.
 */
function includesCurrent(target: Target): boolean {
  return target.scope === "all" || (target.scope === "one" && target.session.current);
}

/**
 * **Tus dispositivos**: every session this account has, and a way to end one,
 * every other or every one (ASVS 5.0.0 7.5.2, PROGRESS D143).
 *
 * It replaces "Cerrar la sesión en todos los dispositivos", which ended every
 * session without a password and could end nothing less. The server half is
 * `auth.listSessions` and `auth.endSessions`.
 *
 * **Every action asks for the password** (`ReauthDialog`), including ending
 * this device's own session: a phone somebody else has picked up must not be
 * able to sign its owner out anywhere, nor end the session it is about to be
 * thrown out of.
 *
 * **Two shapes of ending, decided by whether this device is among them.**
 * "Cerrar todas", and "Cerrar esta sesión" on this device's row, end the
 * session rendering the screen — so they run `useEndSession` with the server
 * call as its `before`, exactly as the sign-out control does: the server
 * first, then the queue, the persisted reads and the cached shell, then the
 * redirect; a refusal discards nothing. Changes still waiting to be sent are
 * offered the same two answers as signing out — send first, or discard.
 * "Cerrar las demás", and "Cerrar esta sesión" on any other row, leave this
 * device signed in: they purge nothing, and the list is read again.
 *
 * **What a row is called.** The screen the device opens on, where it has
 * chosen one — that is what tells the kitchen tablet from a phone of the same
 * make — else the browser and system its User-Agent names. Never a token or
 * the device id, which the server does not send.
 */
export function DeviceList(): JSX.Element {
  const t = useTranslations("security");
  const tSession = useTranslations("session");
  const tOffline = useTranslations("offline");
  const locale = useLocale();
  const snackbar = useSnackbar();
  const utils = api.useUtils();

  const sessions = api.auth.listSessions.useQuery();
  const endSessions = api.auth.endSessions.useMutation({
    // **`always`, not the client's `online` default.** Offline, an `online`
    // mutation is *paused* rather than rejected — `src/lib/offline/persist.ts`
    // says so in as many words — and `mutateAsync`'s promise then never
    // settles. The dialog awaits it, so it would sit on "Un momento…" with
    // every button disabled, showing no failure and ending nothing; and the
    // mutation would fire unannounced when the network came back. Somebody
    // who has just lost a phone is owed a refusal they can read and retry.
    networkMode: "always",
  });

  /**
   * The input the purge sequence's `before` sends.
   *
   * `useEndSession` takes its `before` when the component renders, and the
   * password exists only once the dialog is submitted, so the sequence reads
   * it from here at the moment it runs.
   */
  const request = useRef<EndSessionsInput | null>(null);
  const { pending, unsaved, leave, sendThenLeave } = useEndSession(() => {
    const input = request.current;
    if (input === null) throw new Error("no sessions chosen to end");
    return endSessions.mutateAsync(input);
  });

  const [target, setTarget] = useState<Target | null>(null);
  // The button that opened the dialog, where focus goes back to. One ref for
  // every opener, set on the click: only one dialog is open at a time.
  const opener = useRef<HTMLButtonElement | null>(null);
  // Where focus goes when the ending took the opener with it: the row whose
  // "Cerrar esta sesión" it was, or "Cerrar las demás" once there are none.
  const list = useRef<HTMLUListElement>(null);

  function nameOf(session: Listed): string {
    if (session.screen) return t(`screen${session.screen}`);
    return deviceName(session);
  }

  function deviceName(session: Listed): string {
    const { browser, os } = session.device;
    if (browser && os) return t("deviceOn", { browser, os });
    return browser ?? os ?? t("deviceUnknown");
  }

  function open(next: Target, button: HTMLButtonElement): void {
    opener.current = button;
    setTarget(next);
  }

  function inputFor(chosen: Target, currentPassword: string): EndSessionsInput {
    return chosen.scope === "one"
      ? { currentPassword, scope: "one", sessionId: chosen.session.id }
      : { currentPassword, scope: chosen.scope };
  }

  async function submit(currentPassword: string, actionId: string): Promise<void> {
    if (target === null) return;
    const input = inputFor(target, currentPassword);

    if (includesCurrent(target)) {
      // The page goes to /login when this resolves; nothing after it runs.
      // Cleared however it ends, so the password does not outlive the
      // attempt. `.finally` rather than `try`, which the React Compiler
      // cannot yet memoise around an await.
      request.current = input;
      await (actionId === "send" ? sendThenLeave() : leave()).finally(() => {
        request.current = null;
      });
      return;
    }

    const result = await endSessions.mutateAsync(input).catch(async (error: unknown) => {
      // Gone already — ended from another device, or expired — so the list
      // this dialog was opened from is out of date either way.
      if (codeOf(error) === "NOT_FOUND") await utils.auth.listSessions.invalidate();
      throw error;
    });
    await utils.auth.listSessions.invalidate();
    snackbar.show({
      kind: "confirm",
      message:
        target.scope === "one"
          ? { key: "security.endedOne", values: { device: target.name } }
          : { key: "security.endedOthers", values: { count: result.ended } },
    });
    setTarget(null);
  }

  /**
   * The refusals only this screen understands. Which half of the purge
   * sequence failed decides what is true, and the two are opposites: `unsent`
   * means nothing happened, `local` means every session was ended and only
   * leaving this device did not finish. The rest — a wrong password, a spent
   * budget — the dialog words itself.
   */
  function describe(error: unknown): string | null {
    if (error instanceof EndSessionError && error.phase === "unsent") {
      return t("endFailedUnsent");
    }
    if (error instanceof EndSessionError && error.phase === "local") {
      // Said for what was ended: "the sessions" after this row's own ending
      // would tell somebody their other devices were signed out too.
      return t("endFailedAfter", { scope: target?.scope === "all" ? "all" : "one" });
    }
    // A `server` failure carries the server's refusal as its cause.
    const refusal = error instanceof EndSessionError ? error.cause : error;
    return codeOf(refusal) === "NOT_FOUND" ? t("endGone") : null;
  }

  if (!sessions.data) {
    return (
      <SectionState
        error={sessions.error}
        fetchStatus={sessions.fetchStatus}
        onRetry={() => void sessions.refetch()}
      />
    );
  }

  const others = sessions.data.some((session) => !session.current);
  const leaving = target !== null && includesCurrent(target);
  const actions: [ReauthAction, ...ReauthAction[]] = !leaving
    ? [
        {
          id: "end",
          label: target?.scope === "others" ? t("endOthers") : target?.scope === "one" ? t("endOne") : t("endAll"),
          variant: "destructive",
        },
      ]
    : pending > 0
      ? [
          { id: "send", label: t("endSendFirst") },
          { id: "discard", label: t("endDiscard"), variant: "destructive" },
        ]
      : [
          {
            id: "leave",
            label: target?.scope === "all" ? t("endAll") : t("endOne"),
            variant: unsaved > 0 ? "destructive" : "default",
          },
        ];

  const title =
    target === null
      ? ""
      : target.scope === "others"
        ? t("endOthersTitle")
        : target.scope === "all"
          ? t("endAllTitle")
          : target.session.current
            ? t("endCurrentTitle")
            : t("endOneTitle", { device: target.name });
  const description =
    target === null
      ? ""
      : target.scope === "others"
        ? t("endOthersBody")
        : target.scope === "all"
          ? t("endAllBody")
          : target.session.current
            ? t("endCurrentBody")
            : t("endOneBody");

  return (
    <>
      <ul className="space-y-3" ref={list} tabIndex={-1}>
        {sessions.data.map((session) => {
          const name = nameOf(session);
          return (
            <ItemRow
              key={session.id}
              meta={[
                // The browser too, when the title is the screen: the kitchen
                // tablet is named by its screen, and a second tablet that chose
                // the same one is told apart by what it runs.
                ...(session.screen ? [{ label: t("metaDevice"), value: deviceName(session) }] : []),
                { label: t("metaLastUsed"), value: formatDateTime(locale, session.lastUsedAt) },
                { label: t("metaSignedIn"), value: formatDateTime(locale, session.signedInAt) },
                { label: t("metaExpires"), value: formatDateTime(locale, session.expiresAt) },
                {
                  label: t("metaKind"),
                  value: session.remembered ? t("kindRemembered") : t("kindBrowser"),
                },
              ]}
              status={session.current ? <Badge tone="neutral">{t("thisDevice")}</Badge> : undefined}
              title={name}
              actions={
                <Button
                  // Every row has this button, so its name says whose. It
                  // begins with the words on the screen, so speaking them
                  // still finds it (WCAG 2.5.3).
                  aria-label={t("endOneNamed", { device: name })}
                  onClick={(event) =>
                    open({ scope: "one", session, name }, event.currentTarget)
                  }
                  type="button"
                  variant="ghost"
                >
                  {t("endOne")}
                </Button>
              }
            />
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        {/* Only when there is another to end. */}
        {others ? (
          <Button
            onClick={(event) => open({ scope: "others" }, event.currentTarget)}
            type="button"
            variant="outline"
          >
            {t("endOthers")}
          </Button>
        ) : null}
        <Button
          onClick={(event) => open({ scope: "all" }, event.currentTarget)}
          type="button"
          variant="destructive"
        >
          {t("endAll")}
        </Button>
      </div>

      {/* The cap the sign-in enforces (D140), said where the sessions are
          counted, so the one that vanished after a new sign-in is explained. */}
      <p className="mt-4 text-sm text-muted-foreground">{t("devicesCap")}</p>

      <ReauthDialog
        actions={actions}
        describe={describe}
        description={description}
        notice={
          leaving && (pending > 0 || unsaved > 0) ? (
            <div className="mb-3 rounded border border-warn-foreground bg-warn p-3 text-sm text-warn-foreground">
              <p>
                {pending > 0 ? t("endPending", { count: pending }) : null}
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
        onClose={() => setTarget(null)}
        onSubmit={submit}
        open={target !== null}
        returnFocus={opener}
        fallbackFocus={list}
        title={title}
        tone={target?.scope === "all" ? "danger" : "neutral"}
      />
    </>
  );
}

function codeOf(error: unknown): string | undefined {
  return error instanceof TRPCClientError ? (error.data?.code as string | undefined) : undefined;
}
