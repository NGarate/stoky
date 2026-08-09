"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/components/providers/TRPCProvider";
import { getAuthErrorKey } from "@/lib/auth/error-messages";
import type { FormEvent, JSX } from "react";
import type { AuthErrorKey } from "@/lib/auth/error-messages";

export default function RegisterPage(): JSX.Element {
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

    try {
      await registerMutation.mutateAsync({
        email,
        name,
        password,
        householdName: householdName || undefined,
      });

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (!result || result.error) {
        setErrorKey(getAuthErrorKey(result?.error, "login"));
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
          "register",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-border bg-card shadow-xl lg:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-4">
              <p className="text-sm uppercase tracking-[0.3em] text-primary-foreground">
                Stoky
              </p>
              <h1 className="max-w-sm text-4xl font-semibold leading-tight">
                Register
              </h1>
              <p className="max-w-md text-sm leading-6 text-primary-foreground">
                {t("registerSubtitle")}
              </p>
            </div>
            <div className="rounded-2xl border border-primary-foreground/20 bg-primary-foreground/10 p-5 text-sm text-primary-foreground">
              <p className="font-medium text-primary-foreground">Primer hogar</p>
              <p className="mt-2 leading-6 text-primary-foreground">
                Puedes crear el hogar inicial ahora o dejarlo para después si
                solo quieres validar la entrada a la app.
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
                  Register
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
                  <Input
                    autoComplete="name"
                    id="name"
                    name="name"
                    required
                    type="text"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="email"
                  >
                    {t("email")}
                  </label>
                  <Input
                    autoComplete="email"
                    id="email"
                    name="email"
                    required
                    type="email"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="password"
                  >
                    {t("password")}
                  </label>
                  <Input
                    autoComplete="new-password"
                    id="password"
                    name="password"
                    required
                    type="password"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-foreground"
                    htmlFor="householdName"
                  >
                    {t("householdName")}
                  </label>
                  <Input
                    id="householdName"
                    name="householdName"
                    type="text"
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("householdHint")}
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
