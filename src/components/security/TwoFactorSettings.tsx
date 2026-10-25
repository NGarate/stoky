"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionState } from "@/components/household/RouteState";
import { ReauthDialog } from "@/components/session/ReauthDialog";
import { BackupCodes } from "@/components/security/BackupCodes";
import { TotpSetup } from "@/components/security/TotpSetup";
import {
  AccountChangeRefusedError,
  replaceBackupCodes,
  startTotpEnrolment,
  turnOffTwoFactor,
  type TotpEnrolment,
} from "@/lib/auth/client";
import { api } from "@/lib/trpc/client";
import type { JSX } from "react";

/** What the section is showing besides its status. */
type Step =
  | { kind: "idle" }
  | { kind: "scan"; enrolment: TotpEnrolment }
  | { kind: "codes"; codes: string[]; after: "enabled" | "regenerated" };

/** Which password dialog is open. */
type Asking = "enable" | "disable" | "regenerate" | null;

/** The last change made here, said once it is done. */
type Changed = "enabled" | "disabled" | "regenerated" | null;

/**
 * Whether two-step verification is on, and the way to turn it on, replace
 * its backup codes or turn it off (PROGRESS D148, D149) — the section of
 * `/settings/security` below the password.
 *
 * **For every role.** The kitchen's shared account may protect itself too;
 * the owner decided so on 2026-10-15. Nothing here reads the role.
 *
 * **Every change asks for the password** (`ReauthDialog`), which the auth
 * route charges against the same budgets as every other re-entered password
 * (`src/server/http/auth-handler.ts`): a phone somebody else has picked up
 * must not be able to turn the second step off, or read a fresh set of codes.
 *
 * **Turning it on is two requests, and nothing is on after the first.** The
 * password answers the new authenticator's address and the backup codes;
 * the first code the new app shows, checked by the server, turns it on. Only
 * then are the codes shown, so nobody writes down codes for a second step
 * that never started. Leaving before that leaves it off.
 *
 * **The codes are shown once and kept nowhere.** They live in this
 * component's state for as long as their step is open and go with it: never
 * the query cache, never storage, never the URL. The server holds them only
 * as hashes (D149) and has no way to show them again, and the screen says so.
 *
 * **After a change, a way to the devices list** (ASVS 5.0.0 7.4.3): somebody
 * who turns this on because another person may know their password should
 * also end the sessions that person may have.
 */
export function TwoFactorSettings(): JSX.Element {
  const t = useTranslations("twoFactorSettings");
  const utils = api.useUtils();
  const me = api.auth.me.useQuery(undefined, { retry: false });

  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [asking, setAsking] = useState<Asking>(null);
  const [changed, setChanged] = useState<Changed>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  // "Activar", where focus goes when the setup is cancelled: the step being
  // left had it, and is gone (WCAG 2.4.3).
  const turnOnButton = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!cancelled.current) return;
    cancelled.current = false;
    turnOnButton.current?.focus();
  }, [step]);

  if (!me.data) {
    return (
      <SectionState
        error={me.error}
        fetchStatus={me.fetchStatus}
        onRetry={() => void me.refetch()}
      />
    );
  }
  const enabled = me.data.twoFactorEnabled;

  function ask(next: Exclude<Asking, null>, button: HTMLButtonElement): void {
    opener.current = button;
    setChanged(null);
    setAsking(next);
  }

  /**
   * The server's state, read again: what this screen showed was out of date
   * or has changed. The devices list too: turning it on (at the first code)
   * and turning it off each make Better Auth replace this browser's session
   * with a new row, so the list above would otherwise still show the old row
   * as this device — at the moment the screen points to it (7.4.3).
   */
  async function refresh(): Promise<void> {
    await Promise.all([
      utils.auth.me.invalidate(),
      utils.auth.listSessions.invalidate(),
    ]);
  }

  async function submit(password: string): Promise<void> {
    // A refusal saying the screen was out of date reads the state again,
    // then rejects as usual so the dialog words it.
    const settled = (error: unknown) => {
      if (
        error instanceof AccountChangeRefusedError &&
        (error.code === "already_enabled" || error.code === "not_enabled")
      ) {
        void refresh();
      }
      throw error;
    };

    if (asking === "enable") {
      const enrolment = await startTotpEnrolment(password).catch(settled);
      setAsking(null);
      setStep({ kind: "scan", enrolment });
    } else if (asking === "regenerate") {
      const codes = await replaceBackupCodes(password).catch(settled);
      setAsking(null);
      setStep({ kind: "codes", codes, after: "regenerated" });
    } else if (asking === "disable") {
      await turnOffTwoFactor(password).catch(settled);
      await refresh();
      setAsking(null);
      setChanged("disabled");
    }
  }

  /** The refusals only this section understands; the rest the dialog words. */
  function describe(error: unknown): string | null {
    if (!(error instanceof AccountChangeRefusedError)) return null;
    switch (error.code) {
      case "already_enabled":
        return t("alreadyEnabled");
      case "not_enabled":
        return t("notEnabled");
      case "signed_out":
        return t("signedOut");
      default:
        return null;
    }
  }

  async function verified(): Promise<void> {
    if (step.kind !== "scan") return;
    const codes = step.enrolment.backupCodes;
    await refresh();
    setStep({ kind: "codes", codes, after: "enabled" });
  }

  function codesSaved(): void {
    if (step.kind !== "codes") return;
    setChanged(step.after);
    // The codes go with the step: nothing keeps them past this.
    setStep({ kind: "idle" });
  }

  const dialog =
    asking === "enable"
      ? {
          title: t("turnOnTitle"),
          description: t("turnOnBody"),
          label: t("turnOnAction"),
          destructive: false,
        }
      : asking === "regenerate"
        ? {
            title: t("regenerateTitle"),
            description: t("regenerateBody"),
            label: t("regenerateAction"),
            destructive: true,
          }
        : {
            title: t("turnOffTitle"),
            description: t("turnOffBody"),
            label: t("turnOffAction"),
            destructive: true,
          };

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-foreground">{t("status")}</span>
        {enabled ? (
          <Badge tone="ok">{t("statusOn")}</Badge>
        ) : (
          <Badge tone="neutral">{t("statusOff")}</Badge>
        )}
      </p>

      {step.kind === "scan" ? (
        <TotpSetup
          onCancel={() => {
            cancelled.current = true;
            setStep({ kind: "idle" });
          }}
          onVerified={verified}
          totpUri={step.enrolment.totpUri}
        />
      ) : step.kind === "codes" ? (
        <BackupCodes codes={step.codes} onDone={codesSaved} />
      ) : (
        <>
          <p className="text-muted-foreground">
            {enabled ? t("explainOn") : t("explainOff")}
          </p>
          <div className="flex flex-wrap gap-3">
            {enabled ? (
              <>
                <Button
                  onClick={(event) => ask("regenerate", event.currentTarget)}
                  type="button"
                  variant="outline"
                >
                  {t("regenerate")}
                </Button>
                <Button
                  onClick={(event) => ask("disable", event.currentTarget)}
                  type="button"
                  variant="outline"
                >
                  {t("turnOff")}
                </Button>
              </>
            ) : (
              <Button
                onClick={(event) => ask("enable", event.currentTarget)}
                ref={turnOnButton}
                type="button"
              >
                {t("turnOn")}
              </Button>
            )}
          </div>
        </>
      )}

      {/* Always mounted, so a change is announced by a region that was
          already there (WCAG 4.1.3). */}
      <div aria-live="polite" role="status">
        {changed ? <ChangedNotice changed={changed} /> : null}
      </div>

      <ReauthDialog
        actions={[
          {
            id: "go",
            label: dialog.label,
            variant: dialog.destructive ? "destructive" : "default",
          },
        ]}
        description={dialog.description}
        describe={describe}
        onClose={() => setAsking(null)}
        onSubmit={(password) => submit(password)}
        open={asking !== null}
        returnFocus={opener}
        title={dialog.title}
        tone={dialog.destructive ? "danger" : "neutral"}
      />
    </div>
  );
}

/**
 * What changed, and the way to the devices list (ASVS 5.0.0 7.4.3). A link,
 * because it goes somewhere: the list is on this page, above.
 */
function ChangedNotice({
  changed,
}: {
  changed: Exclude<Changed, null>;
}): JSX.Element {
  const t = useTranslations("twoFactorSettings");
  const heading = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [changed]);

  return (
    <div className="space-y-1">
      <p className="font-medium text-foreground" ref={heading} tabIndex={-1}>
        {changed === "enabled"
          ? t("changedEnabled")
          : changed === "disabled"
            ? t("changedDisabled")
            : t("changedRegenerated")}
      </p>
      <p className="text-muted-foreground">
        {t("reviewDevices")}{" "}
        <a
          className="text-primary underline underline-offset-4 hover:decoration-2"
          href="#devices"
        >
          {t("reviewDevicesLink")}
        </a>
      </p>
    </div>
  );
}
