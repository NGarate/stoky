"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PreferencesCluster } from "@/components/ui/PreferencesCluster";
import type { JSX } from "react";

/**
 * Settings hub.
 *
 * `DashboardNav` links here from every dashboard page, so this route existing
 * at all is the point; it is deliberately a plain index of the settings screens
 * that are actually built, not a settings screen itself.
 *
 * It now renders the preferences cluster inline. It previously could not:
 * `LocaleSwitcher` hardcoded `id="locale-switcher"` and `DashboardNav` renders
 * it on every dashboard page including this one, so a second instance put two
 * elements with the same id on the page and `<label for>` named the wrong one.
 * Both controls take their ids and their radio group name from `useId()`, so
 * two instances no longer collide (DESIGN_AUDIT A2.1).
 *
 * What it still does not do, on purpose: household, profile and notification
 * settings. The `settings.household`, `settings.profile` and
 * `settings.notifications` strings exist in both catalogues, but no procedure
 * backs any of them.
 */
export default function SettingsPage(): JSX.Element {
  const t = useTranslations("settings.hub");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-2 text-2xl font-bold text-heading">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("intro")}</p>

      <ul className="mt-6 space-y-4">
        <li className="rounded border border-border bg-card p-4">
          <h2 className="text-lg font-semibold text-heading">
            <Link
              href="/settings/locations"
              className="inline-flex min-h-[44px] items-center text-primary underline"
            >
              {t("locationsTitle")}
            </Link>
          </h2>
          <p className="mt-1 text-muted-foreground">{t("locationsDescription")}</p>
        </li>

        <li className="rounded border border-border bg-card p-4">
          <h2 className="text-lg font-semibold text-heading">
            <Link
              href="/settings/stores"
              className="inline-flex min-h-[44px] items-center text-primary underline"
            >
              {t("storesTitle")}
            </Link>
          </h2>
          <p className="mt-1 text-muted-foreground">{t("storesDescription")}</p>
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-heading">
        {t("preferencesTitle")}
      </h2>
      <p className="mt-2 text-muted-foreground">{t("preferencesDescription")}</p>
      <PreferencesCluster className="mt-4" />

      <h2 className="mt-8 text-lg font-semibold text-heading">{t("pendingTitle")}</h2>
      <p className="mt-2 text-muted-foreground">{t("pendingDescription")}</p>
    </div>
  );
}
