"use client";

import { TRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";
import { ReauthDialog } from "@/components/session/ReauthDialog";
import { useSnackbar } from "@/components/ui/snackbar";
import { api } from "@/lib/trpc/client";
import type { JSX, RefObject } from "react";

/** The tRPC code a refusal carries, read through nothing else. */
function codeOf(error: unknown): string | undefined {
  return error instanceof TRPCClientError
    ? (error.data?.code as string | undefined)
    : undefined;
}

/**
 * **Quitar la verificación en dos pasos**: an admin takes a member's second
 * step off, for somebody who has lost the phone with their authenticator and
 * has no backup code left (PROGRESS D150). The server half is
 * `household.removeMemberTwoFactor`.
 *
 * **It asks for the admin's own password** (`ReauthDialog`), unlike ending a
 * member's sessions (D145): this leaves somebody else's account with only its
 * password, and a session somebody else is holding must not be able to. The
 * description says what it costs the member before the password is typed —
 * every session ends and they set it up again.
 *
 * The page offers it only on rows that have two-step verification, never on
 * the caller's own and never on an owner's to an admin; the server refuses
 * all three whatever the screen shows. The refusals only this act has are
 * worded here: `FORBIDDEN` is an admin reaching for an owner's, and
 * `CONFLICT` is a row that changed under the page — it no longer has it, or
 * its role moved — so the list is read again and the dialog says so. A wrong
 * password or a spent budget the dialog words itself.
 */
export function RemoveMemberTwoFactorDialog({
  member,
  onClose,
  returnFocus,
  fallbackFocus,
}: {
  /** The person whose second step is being removed; `null` keeps it closed. */
  member: { id: string; name: string } | null;
  onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
  /**
   * Where focus goes once it is removed: the row no longer offers the button
   * that opened this, so `returnFocus` has left the page by then.
   */
  fallbackFocus?: RefObject<HTMLElement | null>;
}): JSX.Element {
  const t = useTranslations("household");
  const snackbar = useSnackbar();
  const utils = api.useUtils();

  const remove = api.household.removeMemberTwoFactor.useMutation({
    // `always`, for `DeviceList`'s reason: offline, an `online` mutation
    // pauses, its promise never settles, and the dialog would sit on
    // "Comprobando…" with nothing saying why.
    networkMode: "always",
  });

  async function submit(currentPassword: string): Promise<void> {
    if (member === null) return;
    const target = member;
    await remove
      .mutateAsync({ userId: target.id, currentPassword })
      .catch(async (error: unknown) => {
        // The row the admin chose from is out of date: read it again, so the
        // button goes from the row that no longer has anything to remove.
        if (codeOf(error) === "CONFLICT")
          await utils.household.members.invalidate();
        throw error;
      });
    snackbar.show({
      kind: "confirm",
      message: {
        key: "household.removeTwoFactorDone",
        values: { name: target.name },
      },
    });
    await utils.household.members.invalidate();
    onClose();
  }

  function describe(error: unknown): string | null {
    const code = codeOf(error);
    if (code === "FORBIDDEN") return t("removeTwoFactorNotOwner");
    if (code === "CONFLICT") return t("removeTwoFactorChanged");
    return null;
  }

  return (
    <ReauthDialog
      actions={[
        {
          id: "remove",
          label: t("removeTwoFactorAction"),
          variant: "destructive",
        },
      ]}
      describe={describe}
      description={t("removeTwoFactorBody")}
      onClose={onClose}
      onSubmit={submit}
      open={member !== null}
      returnFocus={returnFocus}
      fallbackFocus={fallbackFocus}
      title={t("removeTwoFactorTitle", { name: member?.name ?? "" })}
      tone="danger"
    />
  );
}
