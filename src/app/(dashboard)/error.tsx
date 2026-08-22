"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import type { JSX } from "react";

/**
 * What a signed-in screen shows when its render throws.
 *
 * There was no boundary anywhere in `src/app` — no `error.tsx`, no
 * `global-error.tsx`. In development that means Next's overlay, which is fine;
 * in production it means "Application error: a client-side exception has
 * occurred", on a blank page, with no way back. On a household's own server
 * that is the end of the session: no navigation renders, so there is nothing to
 * click.
 *
 * Placed at `(dashboard)` rather than at the root because that is where it can
 * still speak the reader's language. `NextIntlClientProvider` lives in the root
 * layout, and a boundary is rendered *in place of* everything below the segment
 * it sits in — so this one is inside the provider and `global-error.tsx` is
 * not, which is why that file says its piece in two hardcoded languages.
 *
 * `REDESIGN_PLAN.md` §7 rule 4: an error should say what to do next. Three
 * things here try to earn that. It says the fault is the application's and that
 * nothing recorded was lost, because the first thought after a screen vanishes
 * is "did I just lose that?" — and the offline queue means the honest answer is
 * no. It offers the retry React already provides. And it shows the digest,
 * which is the only string that connects what the person saw to what the server
 * logged.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  const t = useTranslations("errors");

  useEffect(() => {
    // The server logs its own errors with the same digest; this is the client
    // half, which otherwise goes nowhere at all. Not `logSecurityEvent` — a
    // render fault is a bug, not an event anybody is auditing for.
    console.error("[boundary] a dashboard screen failed to render", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="rounded-xl border border-danger-foreground bg-danger p-6">
        <h1 className="text-2xl font-bold text-danger-foreground md:text-3xl">
          {t("boundaryTitle")}
        </h1>
        <p className="mt-4 leading-6 text-danger-foreground">{t("boundaryBody")}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          {/* 48px, the floor this project holds everything to (PROGRESS D17). A
              person meeting this screen on a phone is already having a bad time. */}
          <Button
            onClick={reset}
            type="button"
          >
            {t("boundaryRetry")}
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard" > {t("boundaryHome")} </Link>
          </Button>
        </div>

        {error.digest ? (
          <div className="mt-6 border-t border-danger-foreground/30 pt-4">
            <p className="text-sm text-danger-foreground">
              {t("boundaryReference", { digest: error.digest })}
            </p>
            <p className="mt-1 text-sm text-danger-foreground">
              {t("boundaryReferenceHint")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
