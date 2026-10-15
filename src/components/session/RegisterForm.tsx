"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PreferencesCluster } from "@/components/ui/PreferencesCluster";
import { api } from "@/components/providers/TRPCProvider";
import { signInWithPassword } from "@/lib/auth/client";
import { getAuthErrorKey } from "@/lib/auth/error-messages";
import { MIN_PASSWORD_LENGTH } from "@/lib/validations/password";
import type { FormEvent, JSX } from "react";
import type { AuthErrorKey } from "@/lib/auth/error-messages";

/**
 * The registration form: the whole of `/register` while registration is open.
 *
 * It was the page itself until the page had a decision to make. Registration
 * can be closed (`STOKY_REGISTRATION`, `src/lib/auth/registration.ts`), and a
 * client component cannot ask the server before it renders, so the page became
 * a server component that chooses between this and `RegistrationClosed`. The
 * form is unchanged by the move; it still handles a closed refusal, because
 * registration can close between rendering the form and submitting it.
 */
export function RegisterForm(): JSX.Element {
  const t = useTranslations("auth");
  const router = useRouter();
  const registerMutation = api.auth.register.useMutation();
  const [errorKey, setErrorKey] = useState<AuthErrorKey | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isNavigating, startTransition] = useTransition();

  const isBusy = isSubmitting || isNavigating || registerMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorKey(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const householdName = String(formData.get("householdName") ?? "").trim();

    // The React Compiler cannot yet memoise a component containing this
    // `try`/`catch` around an await, so it declines to optimise the whole
    // component. A tool limitation rather than a defect: the handler is
    // correct, and the cost is a missed memoisation on a screen that renders a
    // form. Revisit when babel-plugin-react-compiler supports it.
    // react-doctor-disable-next-line react-hooks-js/todo
    try {
      await registerMutation.mutateAsync({
        email,
        name,
        password,
        householdName: householdName || undefined,
      });

      const result = await signInWithPassword({ email, password });

      if (!result.ok) {
        setErrorKey(getAuthErrorKey(undefined, "login", result.code));
        return;
      }

      startTransition(() => {
        // `/`, which asks a new account which screen it wants (Journey 8) —
        // straight to `/dashboard` meant nobody new ever saw `/start`.
        router.replace("/");
        router.refresh();
      });
    } catch (error: unknown) {
      setErrorKey(
        getAuthErrorKey(
          error instanceof Error ? error.message : undefined,
          "register",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-background px-4 py-10">
      {/* Theme and language before sign-in. Switching language here no longer
          reloads the page, so a half-filled registration form survives it
          (DESIGN_AUDIT A2.2, A2.3). */}
      <div className="mx-auto flex w-full max-w-5xl justify-end">
        <PreferencesCluster />
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center pt-6">
        <div className="grid w-full overflow-hidden rounded-3xl border border-border bg-card shadow-xl lg:grid-cols-[1.05fr_0.95fr]">
          {/* The same panel as /login, and deliberately identical but for its
              four strings — a visitor moving between the two pages should see
              one surface, not two treatments (UI-10). */}
          <section className="hidden bg-hero p-10 text-foreground lg:flex lg:flex-col lg:justify-between lg:border-r lg:border-border">
            <div className="space-y-4">
              <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">
                Stoky
              </p>
              <h1 className="max-w-sm text-4xl font-semibold leading-tight text-heading">
                {t("register")}
              </h1>
              <p className="max-w-md text-sm leading-6 text-muted-foreground">
                {t("registerSubtitle")}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 text-sm text-foreground">
              <p className="font-medium text-heading">{t("registerAsideTitle")}</p>
              <p className="mt-2 leading-6 text-muted-foreground">
                {t("registerAsideBody")}
              </p>
            </div>
          </section>

          <section className="p-6 sm:p-10">
            <div className="mx-auto max-w-md space-y-8">
              <div className="space-y-3">
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground lg:hidden">
                  Stoky
                </p>
                <h1 className="text-3xl font-semibold text-heading lg:hidden">
                  {t("register")}
                </h1>
                <p className="text-sm leading-6 text-muted-foreground lg:hidden">
                  {t("registerSubtitle")}
                </p>
              </div>

              {/* method="post" so a no-JS submit cannot leak the password
                  through the query string. See the note on the login form. */}
              <form className="space-y-5" method="post" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="name"
                  >
                    {t("name")}
                  </label>
                  {/* WCAG 3.3.5 (AAA). Attached with `aria-describedby` rather
                      than merely placed underneath: unattached hint text is
                      help for sighted mouse users and for nobody else. The
                      household hint below was already written and already
                      invisible to a screen reader — that is what this fixes. */}
                  <Input
                    aria-describedby="name-hint"
                    autoComplete="name"
                    id="name"
                    name="name"
                    required
                    type="text"
                  />
                  <p className="text-sm text-muted-foreground" id="name-hint">
                    {t("nameHint")}
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="email"
                  >
                    {t("email")}
                  </label>
                  <Input
                    aria-describedby="email-hint"
                    autoComplete="email"
                    id="email"
                    name="email"
                    required
                    type="email"
                  />
                  <p className="text-sm text-muted-foreground" id="email-hint">
                    {t("emailHintRegister")}
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="password"
                  >
                    {t("password")}
                  </label>
                  <Input
                    aria-describedby="password-hint"
                    autoComplete="new-password"
                    id="password"
                    minLength={MIN_PASSWORD_LENGTH}
                    name="password"
                    required
                    type="password"
                  />
                  <p className="text-sm text-muted-foreground" id="password-hint">
                    {t("passwordHintRegister", { min: MIN_PASSWORD_LENGTH })}
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="householdName"
                  >
                    {t("householdName")}
                  </label>
                  <Input
                    aria-describedby="household-hint"
                    id="householdName"
                    name="householdName"
                    type="text"
                  />
                  <p className="text-sm text-muted-foreground" id="household-hint">
                    {t("householdHint")}
                  </p>
                </div>

                {/* Present from the first render, empty until it has
                    something to say.
                    It was inserted together with its text, so the polite
                    region was created at the moment it spoke — the case
                    screen readers may skip, and the reason someone who
                    mistyped a password could be left with a form that looked
                    unchanged and said nothing (WCAG 4.1.3). It carried no
                    `role` either, so there was no fallback role to fall back
                    on. `SyncStatus` owns the one assertive region in this
                    application, so this stays polite. */}
                <p
                  aria-live="polite"
                  className={
                    errorKey
                      ? "rounded-xl border border-danger-foreground bg-danger px-4 py-3 text-sm text-danger-foreground"
                      : "sr-only"
                  }
                  role="status"
                >
                  {errorKey ? t(errorKey) : ""}
                </p>

                <Button className="w-full" disabled={isBusy} type="submit">
                  {isBusy ? t("registering") : t("register")}
                </Button>
              </form>

              <p className="text-sm text-muted-foreground">
                {t("haveAccount")}{" "}
                <Link
                  className="font-medium text-primary underline underline-offset-4"
                  href="/login"
                >
                  {t("login")}
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
