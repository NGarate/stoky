import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
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
/**
 * This route blocks, for the same reason the root layout does.
 *
 * Its translations come from `src/i18n/request.ts`, which asks the signed-in
 * account for its language before falling back to the cookie — so rendering
 * this page reads the session, and reading the session is request data
 * (`src/lib/auth.ts`). There is no child to wrap in `<Suspense>`: the page is
 * a heading, a paragraph and a link, and streaming three strings would trade a
 * prerender it cannot have for a placeholder nobody benefits from.
 *
 * Blocking costs nothing here. This document is served by the service worker
 * from its precache when the network is gone; the worker holds a rendered
 * response, so what Next would or would not have prerendered never enters it.
 */
export const instant = false;

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
      {/* `Button asChild` over a plain `<a>`: the primitive's colour, focus
          ring and 48px floor, rendered into the server's HTML like everything
          else here — a Slot needs no JavaScript to be an anchor. It was a
          hand-written copy of the primary button, which is a copy that stops
          matching the moment the primitive changes. Still `<a>`, not `Link`:
          a full navigation is what a page with no app around it needs. */}
      <Button asChild className="w-fit">
        <a href="/">{t("back")}</a>
      </Button>
    </main>
  );
}
