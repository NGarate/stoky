"use client";

import { ShellCacheGuard } from "@/components/session/ShellCacheGuard";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PreferencesCluster } from "@/components/ui/PreferencesCluster";
import { getAuthErrorKey } from "@/lib/auth/error-messages";
import type { FormEvent, JSX } from "react";
import type { AuthErrorKey } from "@/lib/auth/error-messages";

export default function LoginPage(): JSX.Element {
  const t = useTranslations("auth");
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<AuthErrorKey | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isNavigating, startTransition] = useTransition();

  const isBusy = isSubmitting || isNavigating;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorKey(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    // The React Compiler cannot yet memoise a component containing this
    // `try`/`catch` around an await, so it declines to optimise the whole
    // component. A tool limitation rather than a defect: the handler is
    // correct, and the cost is a missed memoisation on a screen that renders a
    // form. Revisit when babel-plugin-react-compiler supports it.
    // react-doctor-disable-next-line react-hooks-js/todo
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (!result || result.error) {
        setErrorKey(getAuthErrorKey(result?.error, "login", result?.code));
        return;
      }

      startTransition(() => {
        router.replace("/dashboard");
        router.refresh();
      });
    } catch (error: unknown) {
      setErrorKey(
        getAuthErrorKey(
          error instanceof Error ? error.message : undefined,
          "login",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {/* The only end-of-session signal this application has: there is no
          sign-out control anywhere in it. */}
      <ShellCacheGuard userId={null} />
      <main className="flex min-h-screen flex-col bg-background px-4 py-10">
      {/* Theme and language before sign-in: someone whose system is light but
          who needs dark for a visual reason must not have to log in first
          (DESIGN_AUDIT A1.3, A2.2). */}
      <div className="mx-auto flex w-full max-w-5xl justify-end">
        <PreferencesCluster />
      </div>

      {/* `flex-1` rather than a min-height calculation: the cluster above has
          a height, and hardcoding 100vh minus the padding would push the card
          off the bottom by exactly that much. */}
      <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center pt-6">
        <div className="grid w-full overflow-hidden rounded-3xl border border-border bg-card shadow-xl lg:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-4">
              <p className="text-sm uppercase tracking-[0.3em] text-primary-foreground">
                Stoky
              </p>
              <h1 className="max-w-sm text-4xl font-semibold leading-tight">
                Login
              </h1>
              <p className="max-w-md text-sm leading-6 text-primary-foreground">
                {t("loginSubtitle")}
              </p>
            </div>
            <div className="rounded-2xl border border-primary-foreground/20 bg-primary-foreground/10 p-5 text-sm text-primary-foreground">
              <p className="font-medium text-primary-foreground">Hogar compartido</p>
              <p className="mt-2 leading-6 text-primary-foreground">
                Inventario, tickets y precios quedan vinculados a la misma
                sesión del hogar para mantener el estado sincronizado.
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
                  Login
                </h1>
                <p className="text-sm leading-6 text-muted-foreground lg:hidden">
                  {t("loginSubtitle")}
                </p>
              </div>

              {/* method="post" so that if JavaScript has not loaded, the
                  browser falls back to a POST instead of a GET, which would
                  put the password in the URL and therefore in history and
                  server logs. The JS path calls preventDefault and never
                  reaches it. */}
              <form className="space-y-5" method="post" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="email"
                  >
                    {t("email")}
                  </label>
                  {/* WCAG 3.3.5 (AAA). The hint is attached with
                      `aria-describedby` rather than merely placed underneath,
                      because otherwise a screen reader announces "Correo
                      electrónico, editable" and stops — the help exists for
                      sighted mouse users and for nobody else. */}
                  <Input
                    aria-describedby="email-hint"
                    autoComplete="email"
                    id="email"
                    name="email"
                    required
                    type="email"
                  />
                  <p className="text-sm text-muted-foreground" id="email-hint">
                    {t("emailHint")}
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
                    autoComplete="current-password"
                    id="password"
                    name="password"
                    required
                    type="password"
                  />
                  <p className="text-sm text-muted-foreground" id="password-hint">
                    {t("passwordHintLogin")}
                  </p>
                </div>

                {errorKey ? (
                  <p
                    aria-live="polite"
                    className="rounded-xl border border-danger-foreground bg-danger px-4 py-3 text-sm text-danger-foreground"
                  >
                    {t(errorKey)}
                  </p>
                ) : null}

                <Button className="w-full" disabled={isBusy} type="submit">
                  {isBusy ? t("loggingIn") : t("login")}
                </Button>
              </form>

              <p className="text-sm text-muted-foreground">
                {t("noAccount")}{" "}
                <Link
                  className="font-medium text-primary underline underline-offset-4"
                  href="/register"
                >
                  {t("register")}
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
      </main>
    </>
  );
}
