"use client";

import { TRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Input } from "@/components/ui/input";
import {
  MAX_PASSWORD_LENGTH,
  isWrongCurrentPasswordRefusal,
} from "@/lib/validations/password";
import type { FormEvent, JSX, ReactNode, RefObject } from "react";

/** Every reason a confirmation can be refused, each with its own sentence. */
export type ReauthRefusal = "missing" | "wrong" | "tooMany" | "failed";

/**
 * The server's refusal of a re-entered password, in words the person can act
 * on.
 *
 * `confirmCurrentPassword` (`src/lib/auth/reauth.ts`) answers a wrong password
 * with BAD_REQUEST and its own message — never UNAUTHORIZED, because the
 * person is still signed in and the offline queue reads UNAUTHORIZED as a
 * session that has ended — and a spent budget with TOO_MANY_REQUESTS.
 * Anything else is "try again".
 *
 * A refusal wrapped by the sequence that ran the call (`EndSessionError`
 * carries the server's as its `cause`) is read through the wrapper, so a
 * caller can hand the dialog whatever its sequence threw.
 */
export function reauthRefusalOf(error: unknown): Exclude<ReauthRefusal, "missing"> {
  const refusal =
    !(error instanceof TRPCClientError) && error instanceof Error && error.cause !== undefined
      ? error.cause
      : error;
  const code =
    refusal instanceof TRPCClientError ? (refusal.data?.code as string | undefined) : undefined;
  const message = refusal instanceof Error ? refusal.message : undefined;

  if (code === "TOO_MANY_REQUESTS") return "tooMany";
  if (code === "BAD_REQUEST" && isWrongCurrentPasswordRefusal(message)) return "wrong";
  return "failed";
}

/** One way to go ahead, as a button in the dialog's footer. */
export interface ReauthAction {
  id: string;
  label: string;
  variant?: "default" | "destructive";
}

/**
 * Re-entering the password before an action that needs it (ASVS 5.0.0 7.5.2,
 * PROGRESS D143) — on `/settings/security` first, and every later action that
 * asks again uses it too.
 *
 * Modelled on `ResetMemberPasswordDialog`, for the same reason: it carries a
 * field, and a password typed into a row beside other actions is one somebody
 * types for the wrong thing. The dialog's title says what is about to happen
 * and is its accessible name.
 *
 * **More than one way to go ahead.** Ending this device's session with changes
 * still unsent is two acts — send them first, or discard them — and both need
 * the password, so the caller passes its `actions`. The first is what Enter
 * in the field does; with changes waiting it is the one that keeps them.
 *
 * `onSubmit` is the server call. It resolves when the action is done — the
 * caller closes the dialog, or the page has already gone — and rejects with
 * the refusal, which is shown here, beside the field, rather than in a
 * snackbar that would outlive the reason. `describe` lets the caller word a
 * refusal only it understands (an unsent queue, a session already gone);
 * anything it returns `null` for is worded by {@link reauthRefusalOf}.
 */
export function ReauthDialog({
  open,
  title,
  description,
  notice,
  actions,
  onClose,
  onSubmit,
  describe,
  returnFocus,
  fallbackFocus,
  tone = "neutral",
}: {
  open: boolean;
  /** What is about to happen, as a question. The dialog's accessible name. */
  title: string;
  /** What it costs, said before the password is typed. */
  description: string;
  /** Anything else the person must know first: unsent changes, for one. */
  notice?: ReactNode;
  /** At least one. The first is the form's submit, and what Enter does. */
  actions: [ReauthAction, ...ReauthAction[]];
  onClose: () => void;
  onSubmit: (password: string, actionId: string) => Promise<unknown>;
  describe?: (error: unknown) => string | null;
  returnFocus?: RefObject<HTMLElement | null>;
  /** Where focus goes when the action removed the opener (`Dialog`). */
  fallbackFocus?: RefObject<HTMLElement | null>;
  tone?: "neutral" | "danger";
}): JSX.Element {
  const t = useTranslations("reauth");
  const tCommon = useTranslations("common");
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);
  const [working, setWorking] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);

  const sentence: Record<ReauthRefusal, string> = {
    missing: t("missing"),
    wrong: t("wrong"),
    tooMany: t("tooMany"),
    failed: t("failed"),
  };

  function refuse(message: string, fieldIsWrong: boolean): void {
    setRefusal(message);
    setWrong(fieldIsWrong);
    setFocusSignal((signal) => signal + 1);
  }

  function close(): void {
    // Nothing of a refused attempt survives into the next dialog.
    setRefusal(null);
    setWrong(false);
    onClose();
  }

  async function attempt(actionId: string): Promise<void> {
    const password = field.current?.value ?? "";
    if (password.length === 0) {
      refuse(sentence.missing, true);
      return;
    }

    setRefusal(null);
    setWrong(false);
    setWorking(true);
    // The React Compiler cannot yet memoise a component with a `try`/`catch`
    // around an await, the same limitation `RegisterForm` records.
    // react-doctor-disable-next-line react-hooks-js/todo
    try {
      await onSubmit(password, actionId);
    } catch (error) {
      const kind = reauthRefusalOf(error);
      refuse(describe?.(error) ?? sentence[kind], kind === "wrong");
    } finally {
      setWorking(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void attempt(actions[0].id);
  }

  const formId = `${fieldId}-form`;
  const [first, ...rest] = actions;

  return (
    <Dialog
      description={description}
      footer={
        <>
          <Button onClick={close} type="button" variant="outline">
            {tCommon("cancel")}
          </Button>
          {/* Outside the form in the DOM, because the dialog puts its actions
              in a footer of their own; `form` is what makes the first one
              this form's submit, so Enter in the field and that button do
              one thing. */}
          <Button
            disabled={working}
            form={formId}
            type="submit"
            variant={first.variant ?? "default"}
          >
            {working ? t("working") : first.label}
          </Button>
          {rest.map((action) => (
            <Button
              disabled={working}
              key={action.id}
              onClick={() => void attempt(action.id)}
              type="button"
              variant={action.variant ?? "default"}
            >
              {working ? t("working") : action.label}
            </Button>
          ))}
        </>
      }
      onClose={close}
      open={open}
      returnFocus={returnFocus}
      fallbackFocus={fallbackFocus}
      title={title}
      tone={tone}
    >
      {notice}
      <FormErrorSummary
        focusSignal={focusSignal}
        messages={refusal ? [refusal] : []}
        title={t("refusedTitle")}
      />
      {/* `noValidate`: the summary above says what is wrong, in this
          application's words. `method="post"` so a submit before hydration
          cannot put a password in the query string. */}
      <form
        className="mt-3 space-y-2"
        id={formId}
        method="post"
        noValidate
        onSubmit={handleSubmit}
      >
        <label className="text-sm font-medium text-foreground" htmlFor={`${fieldId}-password`}>
          {t("password")}
        </label>
        <Input
          aria-describedby={`${fieldId}-hint`}
          aria-invalid={wrong || undefined}
          autoComplete="current-password"
          id={`${fieldId}-password`}
          maxLength={MAX_PASSWORD_LENGTH}
          name="currentPassword"
          ref={field}
          required
          type="password"
        />
        <p className="text-sm text-muted-foreground" id={`${fieldId}-hint`}>
          {t("passwordHint")}
        </p>
      </form>
    </Dialog>
  );
}
