"use client";

import { TRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/trpc/client";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  isPasswordIdentityRefusal,
  isWrongCurrentPasswordRefusal,
} from "@/lib/validations/password";
import type { FormEvent, JSX } from "react";

/** Every reason a change can be refused, each with its own sentence. */
type Problem =
  | "missingCurrent"
  | "newPasswordTooShort"
  | "mismatch"
  | "wrongCurrent"
  | "tooEasy"
  | "identity"
  | "tooMany"
  | "failed";

/**
 * The server's refusal, in words the person can act on.
 *
 * A wrong current password is BAD_REQUEST with its own message, never
 * UNAUTHORIZED — the person is still signed in. Any other BAD_REQUEST that is
 * not the identity rule is the policy refusing the new password (too short,
 * too common): the current one is bounded at the same maximum the field
 * enforces, so the schema cannot refuse it for anything a person can type.
 */
function serverProblem(error: unknown): Problem {
  const code =
    error instanceof TRPCClientError
      ? (error.data?.code as string | undefined)
      : undefined;
  const message = error instanceof Error ? error.message : undefined;

  if (code === "TOO_MANY_REQUESTS") return "tooMany";
  if (code === "BAD_REQUEST") {
    if (isWrongCurrentPasswordRefusal(message)) return "wrongCurrent";
    if (isPasswordIdentityRefusal(message)) return "identity";
    return "tooEasy";
  }
  return "failed";
}

/**
 * A signed-in person changing their own password, on `/settings/security`.
 *
 * Until `auth.changePassword` existed, nothing changed a password once it was
 * set: the one an admin chose for a member stayed known to that admin, and a
 * leaked one could not be rotated (security review, 2026-10-12).
 *
 * **This device stays signed in** (PROGRESS D144). The server ends every
 * other session the account has and gives this one a new token, whose cookie
 * comes back with the answer — which is why the call goes by a link that does
 * not stream (`src/lib/trpc/links.ts`). Nothing local is discarded: the
 * queue, the saved reads and the cached shell belong to the same person, who
 * is still here. The form says so before it is submitted, says so again in
 * place when it is done, empties its fields, and has the devices list above
 * read again, since the sessions on it are gone and this one's id changed.
 *
 * A wrong current password, a new one the policy refuses, a spent budget:
 * each is named, and the person stays on the form holding what they typed.
 *
 * A confirmation field, because there is no way back from a mistyped new
 * password but an admin or the database. The checks the browser can make —
 * empty, too short, the two not matching — are made here, all at once, and
 * reported in the form's error summary; the rest is the server's.
 */
export function ChangePasswordForm(): JSX.Element {
  const t = useTranslations("password");
  const fieldId = useId();
  const utils = api.useUtils();
  const change = api.auth.changePassword.useMutation({
    // `always`, for `DeviceList`'s reason: offline, an `online`
    // mutation pauses, its promise never settles, and this form would sit on
    // "Cambiando…" with every control disabled.
    networkMode: "always",
  });
  const [problems, setProblems] = useState<Problem[]>([]);
  const [changed, setChanged] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);

  function refuse(found: Problem[]): void {
    setProblems(found);
    setFocusSignal((signal) => signal + 1);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setChanged(false);
    // Read before the await: React clears `currentTarget` once the handler
    // has returned control.
    const form = event.currentTarget;

    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const again = String(data.get("confirmPassword") ?? "");

    const found: Problem[] = [];
    if (currentPassword.length === 0) found.push("missingCurrent");
    if (newPassword.length < MIN_PASSWORD_LENGTH)
      found.push("newPasswordTooShort");
    if (newPassword !== again) found.push("mismatch");
    if (found.length > 0) {
      refuse(found);
      return;
    }

    setProblems([]);

    // The React Compiler cannot yet memoise a component with a `try`/`catch`
    // around an await, the same limitation `RegisterForm` records.
    // react-doctor-disable-next-line react-hooks-js/todo
    try {
      await change.mutateAsync({ currentPassword, newPassword });
    } catch (error) {
      refuse([serverProblem(error)]);
      return;
    }

    form.reset();
    setChanged(true);
    void utils.auth.listSessions.invalidate();
  }

  const sentence: Record<Problem, string> = {
    missingCurrent: t("missingCurrent"),
    newPasswordTooShort: t("newPasswordTooShort", { min: MIN_PASSWORD_LENGTH }),
    mismatch: t("mismatch"),
    wrongCurrent: t("wrongCurrent"),
    tooEasy: t("tooEasy"),
    identity: t("identity"),
    tooMany: t("tooMany"),
    failed: t("failed"),
  };

  const currentInvalid = problems.some(
    (p) => p === "missingCurrent" || p === "wrongCurrent",
  );
  const newInvalid = problems.some(
    (p) => p === "newPasswordTooShort" || p === "tooEasy" || p === "identity",
  );
  const confirmInvalid = problems.includes("mismatch");

  return (
    <div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <FormErrorSummary
        className="mt-4"
        focusSignal={focusSignal}
        messages={problems.map((p) => sentence[p])}
        title={t("refusedTitle")}
      />

      {/* Always mounted, empty until a change succeeds, so the sentence is
          announced when it appears (WCAG 4.1.3) without taking focus from
          the button that was pressed. */}
      <div
        aria-live="polite"
        className="mt-4 space-y-1 text-sm empty:mt-0"
        role="status"
      >
        {changed ? (
          <>
            <p className="font-medium text-foreground">{t("changedTitle")}</p>
            <p className="text-muted-foreground">{t("changedDetail")}</p>
          </>
        ) : null}
      </div>

      {/* `noValidate`: the browser would stop the submit at the first empty
          field and say one thing; the summary above says all of them, in
          this application's words. `method="post"` so a submit before
          hydration cannot put a password in the query string. */}
      <form
        className="mt-4 space-y-5"
        method="post"
        noValidate
        onSubmit={handleSubmit}
      >
        <div className="space-y-2">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor={`${fieldId}-current`}
          >
            {t("current")}
          </label>
          {/* Every field carries its help, attached (WCAG 3.3.5, AAA). */}
          <Input
            aria-describedby={`${fieldId}-current-hint`}
            aria-invalid={currentInvalid || undefined}
            autoComplete="current-password"
            id={`${fieldId}-current`}
            maxLength={MAX_PASSWORD_LENGTH}
            name="currentPassword"
            required
            type="password"
          />
          <p
            className="text-sm text-muted-foreground"
            id={`${fieldId}-current-hint`}
          >
            {t("currentHint")}
          </p>
        </div>

        <div className="space-y-2">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor={`${fieldId}-new`}
          >
            {t("new")}
          </label>
          <Input
            aria-describedby={`${fieldId}-new-hint`}
            aria-invalid={newInvalid || undefined}
            autoComplete="new-password"
            id={`${fieldId}-new`}
            maxLength={MAX_PASSWORD_LENGTH}
            minLength={MIN_PASSWORD_LENGTH}
            name="newPassword"
            required
            type="password"
          />
          <p
            className="text-sm text-muted-foreground"
            id={`${fieldId}-new-hint`}
          >
            {t("newPasswordHint", { min: MIN_PASSWORD_LENGTH })}
          </p>
        </div>

        <div className="space-y-2">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor={`${fieldId}-confirm`}
          >
            {t("confirm")}
          </label>
          <Input
            aria-describedby={`${fieldId}-confirm-hint`}
            aria-invalid={confirmInvalid || undefined}
            autoComplete="new-password"
            id={`${fieldId}-confirm`}
            maxLength={MAX_PASSWORD_LENGTH}
            name="confirmPassword"
            required
            type="password"
          />
          <p
            className="text-sm text-muted-foreground"
            id={`${fieldId}-confirm-hint`}
          >
            {t("confirmHint")}
          </p>
        </div>

        {/* Before the button and attached to it, so what pressing it does to
            the sessions is heard with the button's name, not after. */}
        <p className="text-sm text-muted-foreground" id={`${fieldId}-ends`}>
          {t("endsSessions")}
        </p>

        <Button
          aria-describedby={`${fieldId}-ends`}
          disabled={change.isPending}
          type="submit"
        >
          {change.isPending ? t("working") : t("submit")}
        </Button>
      </form>
    </div>
  );
}
