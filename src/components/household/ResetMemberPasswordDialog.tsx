"use client";

import { TRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Input } from "@/components/ui/input";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  isPasswordIdentityRefusal,
} from "@/lib/validations/password";
import type { FormEvent, JSX, RefObject } from "react";

/** Every reason a reset can be refused, each with its own sentence. */
export type ResetRefusal =
  | "tooShort"
  | "tooEasy"
  | "identity"
  | "notOwner"
  | "tooMany"
  | "failed";

/**
 * The server's refusal, in words the admin can act on.
 *
 * `FORBIDDEN` is an admin reaching for an owner's password, and the answer is
 * to ask an owner. Any `BAD_REQUEST` that is not the identity rule is the
 * policy refusing the password (too short, too common) — the screen never
 * offers the caller's own row, so the other `BAD_REQUEST` the procedure has
 * does not reach here. Everything else — the member gone, the member changed
 * while the hash ran, the network — is "try again".
 */
export function resetRefusalOf(error: unknown): ResetRefusal {
  const code =
    error instanceof TRPCClientError ? (error.data?.code as string | undefined) : undefined;
  const message = error instanceof Error ? error.message : undefined;

  if (code === "TOO_MANY_REQUESTS") return "tooMany";
  if (code === "FORBIDDEN") return "notOwner";
  if (code === "BAD_REQUEST") {
    return isPasswordIdentityRefusal(message) ? "identity" : "tooEasy";
  }
  return "failed";
}

/**
 * An admin setting a new password for somebody in the household, on
 * `/settings/people`.
 *
 * There is no email in this application, so a forgotten password has no link
 * to follow; this is the way back. It is also the answer to "somebody else
 * knows their password": the procedure ends every session the member has, so
 * whoever used the old one is out too, and the description says so before the
 * button is pressed.
 *
 * **A dialog rather than the row's inline confirmation**, because this one
 * carries a field: a password typed into a row that also holds the role
 * select and two other actions is a field somebody fills in for the wrong
 * person. The dialog names the person in its title, which is its accessible
 * name.
 *
 * `onSubmit` is the server call. It resolves when the password is set — the
 * page then closes the dialog and says what to do next — and rejects with the
 * refusal, which is shown here, in the dialog where the field is, rather than
 * in a snackbar that would outlive the reason.
 */
export function ResetMemberPasswordDialog({
  member,
  onClose,
  onSubmit,
  returnFocus,
}: {
  /** The person whose password is being set; `null` keeps the dialog closed. */
  member: { id: string; name: string } | null;
  onClose: () => void;
  onSubmit: (newPassword: string) => Promise<unknown>;
  returnFocus?: RefObject<HTMLElement | null>;
}): JSX.Element {
  const t = useTranslations("household");
  const tCommon = useTranslations("common");
  const fieldId = useId();
  const [refusal, setRefusal] = useState<ResetRefusal | null>(null);
  const [working, setWorking] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);

  function refuse(found: ResetRefusal): void {
    setRefusal(found);
    setFocusSignal((signal) => signal + 1);
  }

  function close(): void {
    // Nothing of a refused attempt survives into the next person's dialog.
    setRefusal(null);
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const newPassword = String(new FormData(event.currentTarget).get("newPassword") ?? "");

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      refuse("tooShort");
      return;
    }

    setRefusal(null);
    setWorking(true);
    // The React Compiler cannot yet memoise a component with a `try`/`catch`
    // around an await, the same limitation `RegisterForm` records.
    // react-doctor-disable-next-line react-hooks-js/todo
    try {
      await onSubmit(newPassword);
    } catch (error) {
      refuse(resetRefusalOf(error));
    } finally {
      setWorking(false);
    }
  }

  const sentence: Record<ResetRefusal, string> = {
    tooShort: t("resetTooShort", { min: MIN_PASSWORD_LENGTH }),
    tooEasy: t("resetTooEasy"),
    identity: t("addPasswordIdentity"),
    notOwner: t("resetFailedNotOwner"),
    tooMany: t("resetTooMany"),
    failed: t("resetFailed"),
  };
  const formId = `${fieldId}-form`;
  const invalid = refusal === "tooShort" || refusal === "tooEasy" || refusal === "identity";

  return (
    <Dialog
      description={t("resetBody")}
      footer={
        <>
          <Button onClick={close} type="button" variant="outline">
            {tCommon("cancel")}
          </Button>
          {/* Outside the form in the DOM, because the dialog puts its actions
              in a footer of their own; `form` is what makes it this form's
              submit, so Enter in the field and this button do one thing. */}
          <Button disabled={working} form={formId} type="submit">
            {working ? t("resetWorking") : t("resetSubmit")}
          </Button>
        </>
      }
      onClose={close}
      open={member !== null}
      returnFocus={returnFocus}
      title={t("resetTitle", { name: member?.name ?? "" })}
    >
      <FormErrorSummary
        focusSignal={focusSignal}
        messages={refusal ? [sentence[refusal]] : []}
        title={t("resetRefusedTitle")}
      />
      {/* `noValidate`: the summary above says what is wrong, in this
          application's words. `method="post"` so a submit before hydration
          cannot put a password in the query string. */}
      <form
        className="space-y-2"
        id={formId}
        method="post"
        noValidate
        onSubmit={handleSubmit}
      >
        <label className="text-sm font-medium text-foreground" htmlFor={`${fieldId}-new`}>
          {t("resetPassword")}
        </label>
        <Input
          aria-describedby={`${fieldId}-hint`}
          aria-invalid={invalid || undefined}
          autoComplete="new-password"
          id={`${fieldId}-new`}
          maxLength={MAX_PASSWORD_LENGTH}
          minLength={MIN_PASSWORD_LENGTH}
          name="newPassword"
          required
          type="password"
        />
        <p className="text-sm text-muted-foreground" id={`${fieldId}-hint`}>
          {t("resetPasswordHint", { min: MIN_PASSWORD_LENGTH })}
        </p>
      </form>
    </Dialog>
  );
}
