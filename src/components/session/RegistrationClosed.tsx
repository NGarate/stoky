import { useTranslations } from "next-intl";
import { BackLink } from "@/components/ui/back-link";
import { PreferencesCluster } from "@/components/ui/PreferencesCluster";
import type { JSX } from "react";

/**
 * What `/register` shows when registration is closed, instead of the form.
 *
 * The form used to render either way, so a visitor filled in four fields,
 * chose a password and found out only on submitting — and only with JavaScript,
 * since the refusal arrived through the mutation. The page now knows before it
 * renders (`src/app/(auth)/register/page.tsx`), and this says so in the first
 * response: what is closed, who can let the person in, and the way to the
 * screen they can use if they already have an account.
 *
 * No directive, so it renders on the server and ships no JavaScript of its
 * own; `useTranslations` works there for a component that is not `async`. The
 * preferences stay, because the language switch is most needed by somebody who
 * cannot read the sentence above it.
 */
export function RegistrationClosed(): JSX.Element {
  const t = useTranslations("auth");

  return (
    <main className="flex min-h-screen flex-col bg-background px-4 py-10">
      <div className="mx-auto flex w-full max-w-5xl justify-end">
        <PreferencesCluster />
      </div>

      <div className="mx-auto flex w-full max-w-xl flex-1 items-center justify-center pt-6">
        <section className="w-full space-y-6 rounded-3xl border border-border bg-card p-6 shadow-xl sm:p-10">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Stoky
            </p>
            <h1 className="text-3xl font-semibold text-heading">
              {t("registrationClosedTitle")}
            </h1>
            <p className="leading-7 text-foreground">
              {t("registrationClosedBody")}
            </p>
          </div>

          <BackLink href="/login">{t("backToLogin")}</BackLink>
        </section>
      </div>
    </main>
  );
}
