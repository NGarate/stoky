"use client";

import { TRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/trpc/client";
import {
  EndSessionError,
  useEndSession,
} from "@/components/session/use-end-session";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  isPasswordIdentityRefusal,
  isWrongCurrentPasswordRefusal,
} from "@/lib/validations/password";
import type { FormEvent, JSX } from "react";
import type { ChangePasswordInput } from "@/lib/validations/auth";

/** Every reason a change can be refused, each with its own sentence. */
type Problem =
  | "missingCurrent"
  | "newPasswordTooShort"
  | "mismatch"
  | "wrongCurrent"
  | "tooEasy"
  | "identity"
  | "tooMany"
  | "failed"
  | "failedUnsent";

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
    error instanceof TRPCClientError ? (error.data?.code as string | undefined) : undefined;
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
 * A signed-in person changing their own password, on `/settings`.
 *
 * Until `auth.changePassword` existed, nothing changed a password once it was
 * set: the one an admin chose for a member stayed known to that admin, and a
 * leaked one could not be rotated (security review, 2026-10-12).
 *
 * **A success signs this device out, through `useEndSession`.** The procedure
 * moves `sessionsValidFrom`, so the token rendering this form is already
 * refused; leaving through the same sequence as the two sign-out controls
 * purges the queue, the persisted reads and the cached shell before the
 * redirect rather than leaving the next read to discover it. The form says so
 * before it is submitted. Changes still waiting to be sent go first, and a
 * change is refused rather than made when they cannot — the same rule as
 * "Enviar y cerrar sesión".
 *
 * **The server write comes first and may refuse**, which is `useEndSession`'s
 * `before`: a wrong current password discards nothing and leaves the person
 * signed in, holding the form, and told which field is wrong.
 *
 * A confirmation field, because there is no way back from a mistyped new
 * password but an admin or the database. The checks the browser can make —
 * empty, too short, the two not matching — are made here, all at once, and
 * reported in the form's error summary; the rest is the server's.
 */
export function ChangePasswordForm(): JSX.Element {
  const t = useTranslations("password");
  const tSession = useTranslations("session");
  const tOffline = useTranslations("offline");
  const fieldId = useId();
  const change = api.auth.changePassword.useMutation({
    // `always`, for `RevokeSessionsButton`'s reason: offline, an `online`
    // mutation pauses, its promise never settles, and this form would sit on
    // "Cambiando…" with every control disabled.
    networkMode: "always",
  });
  // What `before` sends, set on submit. A ref rather than state because the
  // sequence reads it in the same tick the submit handler writes it.
  const pendingInput = useRef<ChangePasswordInput | null>(null);
  const { pending, unsaved, working, leave, sendThenLeave } = useEndSession(() =>
    change.mutateAsync(pendingInput.current as ChangePasswordInput),
  );
  const [problems, setProblems] = useState<Problem[]>([]);
  const [changedButStuck, setChangedButStuck] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);

  function refuse(found: Problem[]): void {
    setProblems(found);
    setFocusSignal((signal) => signal + 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setChangedButStuck(false);

    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const again = String(data.get("confirmPassword") ?? "");

    const found: Problem[] = [];
    if (currentPassword.length === 0) found.push("missingCurrent");
    if (newPassword.length < MIN_PASSWORD_LENGTH) found.push("newPasswordTooShort");
    if (newPassword !== again) found.push("mismatch");
    if (found.length > 0) {
      refuse(found);
      return;
    }

    setProblems([]);
    pendingInput.current = { currentPassword, newPassword };

    // The React Compiler cannot yet memoise a component with a `try`/`catch`
    // around an await, the same limitation `RegisterForm` records.
    // react-doctor-disable-next-line react-hooks-js/todo
    try {
      await (pending > 0 ? sendThenLeave() : leave());
    } catch (error) {
      if (error instanceof EndSessionError && error.phase === "local") {
        // The password *was* changed and every session ended; only signing
        // out here did not finish. Saying "not changed" would send the person
        // back to type the old one.
        setChangedButStuck(true);
        setFocusSignal((signal) => signal + 1);
        return;
      }
      if (error instanceof EndSessionError && error.phase === "unsent") {
        refuse(["failedUnsent"]);
        return;
      }
      refuse([serverProblem(error instanceof EndSessionError ? error.cause : error)]);
    } finally {
      pendingInput.current = null;
    }
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
    failedUnsent: t("failedUnsent"),
  };

  const currentInvalid = problems.some((p) => p === "missingCurrent" || p === "wrongCurrent");
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
        messages={changedButStuck ? [t("failedAfter")] : problems.map((p) => sentence[p])}
        title={changedButStuck ? t("changedTitle") : t("refusedTitle")}
      />

      {/* `noValidate`: the browser would stop the submit at the first empty
          field and say one thing; the summary above says all of them, in
          this application's words. `method="post"` so a submit before
          hydration cannot put a password in the query string. */}
      <form className="mt-4 space-y-5" method="post" noValidate onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor={`${fieldId}-current`}
          >
            {t("current")}
          </label>
          {/* Every field carries its help, attached (WCAG 3.3.5, AAA), which
              `e2e/a11y-aaa.spec.ts` checks on this route. */}
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
          <p className="text-sm text-muted-foreground" id={`${fieldId}-current-hint`}>
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
          <p className="text-sm text-muted-foreground" id={`${fieldId}-new-hint`}>
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
          <p className="text-sm text-muted-foreground" id={`${fieldId}-confirm-hint`}>
            {t("confirmHint")}
          </p>
        </div>

        {/* Before the button and attached to it, so what pressing it does to
            this session is heard with the button's name, not after. */}
        <div className="space-y-1 text-sm text-muted-foreground" id={`${fieldId}-ends`}>
          <p>{t("endsSessions")}</p>
          {pending > 0 ? <p>{t("pending", { count: pending })}</p> : null}
          {unsaved > 0 ? <p>{tSession("endSessionUnsaved", { count: unsaved })}</p> : null}
        </div>
        {unsaved > 0 ? (
          <Button asChild className="px-0" variant="link">
            <Link href="/settings/unsaved">{tOffline("seeUnsaved")}</Link>
          </Button>
        ) : null}

        <Button aria-describedby={`${fieldId}-ends`} disabled={working} type="submit">
          {working ? t("working") : t("submit")}
        </Button>
      </form>
    </div>
  );
}
