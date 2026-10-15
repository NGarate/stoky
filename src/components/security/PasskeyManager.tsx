"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Input } from "@/components/ui/input";
import { ItemRow } from "@/components/ui/item-row";
import { useSnackbar } from "@/components/ui/snackbar";
import { SectionState } from "@/components/household/RouteState";
import { ReauthDialog } from "@/components/session/ReauthDialog";
import { useSessionName } from "@/components/session/session-name";
import { useWebAuthnSupport } from "@/components/session/webauthn-support";
import {
  AccountChangeRefusedError,
  addPasskey,
  listPasskeys,
  removePasskey,
  renamePasskey,
  type PasskeySummary,
} from "@/lib/auth/client";
import { deviceLabel } from "@/lib/auth/device-label";
import { formatDateTime } from "@/lib/dates";
import { api } from "@/lib/trpc/client";
import type { FormEvent, JSX, RefObject } from "react";

/**
 * Not a tRPC key, so the offline persister never keeps it
 * (`src/lib/offline/persist.ts` keeps only listed tRPC paths): a list of
 * credentials read from a cache would offer to remove ones already gone.
 */
const PASSKEYS_KEY = ["auth-api", "passkeys"] as const;

/** Longest name a passkey is given here; a row title, not a description. */
const MAX_NAME_LENGTH = 64;

const noSubscription = () => () => {};

function usePageOrigin(): string | null {
  return useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => null,
  );
}

/** Which password dialog is open, and for what. */
type Asking = { kind: "add" } | { kind: "remove"; passkey: PasskeySummary; name: string } | null;

/**
 * **Llaves de acceso** on `/settings/security` (PROGRESS D151): the account's
 * passkeys, and a way to add one on this device, rename one, or remove one.
 *
 * **For every role**, the kitchen's shared account included (the owner's
 * decision of 2026-10-15). Nothing here reads the role. The add dialog says
 * what that costs on a device other people use.
 *
 * **Adding and removing ask for the password** (`ReauthDialog`, then
 * `auth.confirmPassword`), which leaves a five-minute step-up the auth API
 * spends on the one change (`src/lib/auth/step-up.ts`). A refused change has
 * spent it; a cancelled browser prompt has not (the options do not spend
 * it), but the dialog stays open and asks for the password again either way,
 * one rule rather than two. Renaming needs the session alone.
 *
 * **Where adding cannot work, the screen says why instead of offering a
 * button that fails.** A passkey belongs to the first `STOKY_URLS` address
 * (`auth.me.passkeyOrigin`, null when the install cannot have them at all):
 * at a second listed address the browser would make a credential the server
 * refuses, so the screen names the address that works. Then the browser:
 * WebAuthn exists only in a secure context, and not in every browser. The
 * list, renaming and removal still work at any address — somebody at the
 * LAN address who has lost a phone can still remove its passkey.
 *
 * **Its own list, not tRPC's**: passkeys live in the auth API
 * (`listPasskeys`, `src/lib/auth/client.ts`), read through TanStack Query
 * like the rest, under a key the offline persister does not keep.
 */
export function PasskeyManager(): JSX.Element {
  const t = useTranslations("security");
  const me = api.auth.me.useQuery(undefined, { retry: false });

  if (!me.data) {
    return (
      <SectionState
        error={me.error}
        fetchStatus={me.fetchStatus}
        onRetry={() => void me.refetch()}
      />
    );
  }
  if (me.data.passkeyOrigin === null) {
    return <p className="text-muted-foreground">{t("passkeysUnavailable")}</p>;
  }
  return <Passkeys origin={me.data.passkeyOrigin} />;
}

function Passkeys({ origin }: { origin: string }): JSX.Element {
  const t = useTranslations("security");
  const locale = useLocale();
  const snackbar = useSnackbar();
  const queryClient = useQueryClient();
  const { deviceName } = useSessionName();
  const confirmPassword = api.auth.confirmPassword.useMutation({
    // As on the devices list: offline, an `online` mutation is paused and its
    // promise never settles, which would leave the dialog waiting for ever.
    networkMode: "always",
  });
  const support = useWebAuthnSupport();
  const pageOrigin = usePageOrigin();

  const passkeys = useQuery({
    queryKey: PASSKEYS_KEY,
    queryFn: () => listPasskeys(),
    networkMode: "always",
    retry: false,
  });

  const [asking, setAsking] = useState<Asking>(null);
  const [renaming, setRenaming] = useState<{ passkey: PasskeySummary; name: string } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  // Where focus goes when a removal took its row, and the row's "Quitar"
  // with it: the sentence that heads the section, which always stays.
  const explanation = useRef<HTMLParagraphElement>(null);

  const reread = () => queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY });
  const nameOf = (passkey: PasskeySummary) => passkey.name ?? t("passkeysUnnamed");

  /**
   * Why adding cannot work here, or null when it can. The address first:
   * at a second listed address the browser is usually also an insecure one,
   * and "go to this address" is the sentence that helps.
   */
  function obstacle(): string | null {
    if (support === "pending" || pageOrigin === null) return null;
    if (pageOrigin !== origin) return t("passkeysOnlyAt", { host: new URL(origin).host });
    if (support === "insecure") return t("passkeysInsecure");
    if (support === "unsupported") return t("passkeysUnsupported");
    return null;
  }
  const blocked = obstacle();
  const canAdd = support === "ready" && pageOrigin === origin;

  function open(next: Exclude<Asking, null>, button: HTMLButtonElement): void {
    opener.current = button;
    setAsking(next);
  }

  async function submit(currentPassword: string): Promise<void> {
    if (asking === null) return;
    await confirmPassword.mutateAsync({ currentPassword });

    if (asking.kind === "add") {
      // Named after where it was made, so the list tells two apart before
      // anybody renames one: "Chrome en Android".
      const name = deviceName({ device: deviceLabel(navigator.userAgent), screen: null });
      await addPasskey(name).catch(async (error: unknown) => {
        await reread();
        throw error;
      });
      await reread();
      snackbar.show({ kind: "confirm", message: { key: "security.passkeysAdded" } });
    } else {
      const { passkey, name } = asking;
      await removePasskey(passkey.id).catch(async (error: unknown) => {
        await reread();
        throw error;
      });
      await reread();
      snackbar.show({
        kind: "confirm",
        message: { key: "security.passkeysRemoved", values: { name } },
      });
    }
    setAsking(null);
  }

  /** The refusals only this section understands; the rest the dialog words. */
  function describe(error: unknown): string | null {
    if (!(error instanceof AccountChangeRefusedError)) return null;
    switch (error.code) {
      case "cancelled":
        return t("passkeysCancelled");
      case "already_registered":
        return t("passkeysAlready");
      case "not_verified":
        return t("passkeysNotVerified");
      case "step_up_required":
        return t("passkeysStepUp");
      case "passkey_gone":
        return t("passkeysGone");
      case "signed_out":
        return t("passkeysSignedOut");
      default:
        return asking?.kind === "add" ? t("passkeysAddFailed") : null;
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground" ref={explanation} tabIndex={-1}>
        {t("passkeysExplain")}
      </p>

      {passkeys.data ? (
        passkeys.data.length === 0 ? (
          <p className="text-muted-foreground">{t("passkeysNone")}</p>
        ) : (
          <ul className="space-y-3">
            {passkeys.data.map((passkey) => {
              const name = nameOf(passkey);
              return (
                <ItemRow
                  key={passkey.id}
                  meta={[
                    { label: t("passkeysCreated"), value: formatDateTime(locale, passkey.createdAt) },
                    {
                      label: t("passkeysWhere"),
                      value: passkey.synced ? t("passkeysSynced") : t("passkeysDeviceOnly"),
                    },
                  ]}
                  title={name}
                  actions={
                    <>
                      <Button
                        // Every row has these, so their names say whose; each
                        // begins with the words on screen (WCAG 2.5.3).
                        aria-label={t("passkeysRenameNamed", { name })}
                        onClick={(event) => {
                          opener.current = event.currentTarget;
                          setRenaming({ passkey, name });
                        }}
                        type="button"
                        variant="ghost"
                      >
                        {t("passkeysRename")}
                      </Button>
                      <Button
                        aria-label={t("passkeysRemoveNamed", { name })}
                        onClick={(event) => open({ kind: "remove", passkey, name }, event.currentTarget)}
                        type="button"
                        variant="destructive-ghost"
                      >
                        {t("passkeysRemove")}
                      </Button>
                    </>
                  }
                />
              );
            })}
          </ul>
        )
      ) : (
        <SectionState
          error={passkeys.error}
          fetchStatus={passkeys.fetchStatus}
          onRetry={() => void passkeys.refetch()}
        />
      )}

      {canAdd ? (
        <Button onClick={(event) => open({ kind: "add" }, event.currentTarget)} type="button">
          {t("passkeysAdd")}
        </Button>
      ) : blocked ? (
        <p className="text-muted-foreground">{blocked}</p>
      ) : null}

      <ReauthDialog
        actions={[
          asking?.kind === "remove"
            ? { id: "remove", label: t("passkeysRemove"), variant: "destructive" }
            : { id: "add", label: t("passkeysAddAction") },
        ]}
        describe={describe}
        description={asking?.kind === "remove" ? t("passkeysRemoveBody") : t("passkeysAddBody")}
        notice={
          asking?.kind === "add" ? (
            <p className="mb-3 rounded border border-warn-foreground bg-warn p-3 text-sm text-warn-foreground">
              {t("passkeysSharedDevice")}
            </p>
          ) : null
        }
        onClose={() => setAsking(null)}
        onSubmit={submit}
        open={asking !== null}
        returnFocus={opener}
        fallbackFocus={explanation}
        title={
          asking?.kind === "remove"
            ? t("passkeysRemoveTitle", { name: asking.name })
            : t("passkeysAddTitle")
        }
        tone={asking?.kind === "remove" ? "danger" : "neutral"}
      />

      <RenameDialog
        onClose={() => setRenaming(null)}
        onRenamed={async () => {
          await reread();
          snackbar.show({ kind: "confirm", message: { key: "security.passkeysRenamed" } });
          setRenaming(null);
        }}
        returnFocus={opener}
        target={renaming}
      />
    </div>
  );
}

/**
 * A new name for one passkey. A dialog rather than an inline field, like
 * every other row action here: the row keeps its grammar, and the field has
 * a label and a place for its error.
 */
function RenameDialog({
  target,
  onClose,
  onRenamed,
  returnFocus,
}: {
  target: { passkey: PasskeySummary; name: string } | null;
  onClose: () => void;
  onRenamed: () => Promise<void>;
  returnFocus: RefObject<HTMLElement | null>;
}): JSX.Element {
  const t = useTranslations("security");
  const tCommon = useTranslations("common");
  const tReauth = useTranslations("reauth");
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);

  function refuse(message: string): void {
    setRefusal(message);
    setFocusSignal((signal) => signal + 1);
  }

  function close(): void {
    setRefusal(null);
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (target === null) return;
    const name = (field.current?.value ?? "").trim();
    if (name.length === 0) {
      refuse(t("passkeysNameMissing"));
      return;
    }
    setRefusal(null);
    setWorking(true);
    void renamePasskey(target.passkey.id, name)
      .then(onRenamed)
      .catch((error: unknown) => {
        refuse(
          error instanceof AccountChangeRefusedError && error.code === "passkey_gone"
            ? t("passkeysGone")
            : tReauth("failed"),
        );
      })
      .finally(() => setWorking(false));
  }

  const formId = `${fieldId}-form`;

  return (
    <Dialog
      footer={
        <>
          <Button onClick={close} type="button" variant="outline">
            {tCommon("cancel")}
          </Button>
          <Button disabled={working} form={formId} type="submit">
            {working ? tReauth("working") : t("passkeysRenameSave")}
          </Button>
        </>
      }
      onClose={close}
      open={target !== null}
      returnFocus={returnFocus}
      title={t("passkeysRenameTitle", { name: target?.name ?? "" })}
    >
      <FormErrorSummary
        focusSignal={focusSignal}
        messages={refusal ? [refusal] : []}
        title={tReauth("refusedTitle")}
      />
      <form className="mt-3 space-y-2" id={formId} method="post" noValidate onSubmit={handleSubmit}>
        <label className="text-sm font-medium text-foreground" htmlFor={`${fieldId}-name`}>
          {t("passkeysNameLabel")}
        </label>
        <Input
          aria-invalid={refusal !== null || undefined}
          autoComplete="off"
          defaultValue={target?.passkey.name ?? ""}
          id={`${fieldId}-name`}
          maxLength={MAX_NAME_LENGTH}
          name="name"
          ref={field}
          required
        />
      </form>
    </Dialog>
  );
}
