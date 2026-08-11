import { getTranslations } from "next-intl/server";
import type { JSX } from "react";
import type { Metadata } from "next";

/**
 * What the service worker serves when there is nothing else to serve.
 *
 * **A Server Component, complete in its server-rendered markup, and legible
 * with zero JavaScript.** Precaching an HTML document does not precache the
 * chunks it references, so anything that needs hydration to be readable is
 * blank exactly when this page is needed. That is why the way out is an
 * `<a href="/">` rather than a button with an `onClick`.
 *
 * It cannot be "no client component anywhere in its tree" — the root layout
 * wraps everything in `TRPCProvider` and `NextIntlClientProvider` — but those
 * contribute nothing but children to the server render, so the requirement
 * that actually matters holds.
 *
 * It carries its own `<main>` and `<h1>`: this route is outside the dashboard
 * layout, and the root layout supplies neither.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("offlinePage");
  return { title: t("title") };
}

export default async function OfflinePage(): Promise<JSX.Element> {
  const t = await getTranslations("offlinePage");

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold text-heading md:text-4xl">
        {t("heading")}
      </h1>
      <p className="text-base text-muted-foreground">{t("body")}</p>
      <a
        className="inline-flex min-h-[48px] w-fit items-center rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        href="/"
      >
        {t("back")}
      </a>
    </main>
  );
}
