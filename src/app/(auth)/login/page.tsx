"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

    try {
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
          "login",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-sky-50 px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden bg-slate-950 p-10 text-slate-50 lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-4">
              <p className="text-sm uppercase tracking-[0.3em] text-amber-300">
                Stoky
              </p>
              <h1 className="max-w-sm text-4xl font-semibold leading-tight">
                Login
              </h1>
              <p className="max-w-md text-sm leading-6 text-slate-300">
                {t("loginSubtitle")}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-200">
              <p className="font-medium text-white">Hogar compartido</p>
              <p className="mt-2 leading-6 text-slate-300">
                Inventario, tickets y precios quedan vinculados a la misma
                sesión del hogar para mantener el estado sincronizado.
              </p>
            </div>
          </section>

          <section className="p-6 sm:p-10">
            <div className="mx-auto max-w-md space-y-8">
              <div className="space-y-3">
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500 lg:hidden">
                  Stoky
                </p>
                <h1 className="text-3xl font-semibold text-slate-950 lg:hidden">
                  Login
                </h1>
                <p className="text-sm leading-6 text-slate-600 lg:hidden">
                  {t("loginSubtitle")}
                </p>
              </div>

              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-slate-800"
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
                    className="text-sm font-medium text-slate-800"
                    htmlFor="password"
                  >
                    {t("password")}
                  </label>
                  <Input
                    autoComplete="current-password"
                    id="password"
                    name="password"
                    required
                    type="password"
                  />
                </div>

                {errorKey ? (
                  <p
                    aria-live="polite"
                    className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
                  >
                    {t(errorKey)}
                  </p>
                ) : null}

                <Button className="w-full" disabled={isBusy} type="submit">
                  {isBusy ? t("loggingIn") : t("login")}
                </Button>
              </form>

              <p className="text-sm text-slate-600">
                {t("noAccount")}{" "}
                <Link
                  className="font-medium text-sky-700 underline underline-offset-4"
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
  );
}
