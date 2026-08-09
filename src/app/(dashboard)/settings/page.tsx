"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { JSX } from "react";

/**
 * Settings hub.
 *
 * `DashboardNav` links here from every dashboard page, so this route existing
 * at all is the point; it is deliberately a plain index of the settings screens
 * that are actually built, not a settings screen itself.
 *
 * Two things it does not do, both on purpose:
 *
 * - It does not render `LocaleSwitcher`. That component hardcodes
 *   `id="locale-switcher"`, and `DashboardNav` already renders it on every
 *   dashboard page — including this one. A second instance would put two
 *   elements with the same id on the page, and its `<label for>` would then
 *   name the wrong one. The language section points at the switcher in the nav
 *   instead.
 * - It does not offer household, profile or notification settings. The
 *   `settings.household`, `settings.profile` and `settings.notifications`
 *   strings exist in both catalogues, but no procedure backs any of them.
 *
 * It is a Client Component only for consistency with every other page under
 * `(dashboard)`; nothing here is interactive.
 */
export default function SettingsPage(): JSX.Element {
  const t = useTranslations("settings.hub");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-2 text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-gray-700">{t("intro")}</p>

      <ul className="mt-6 space-y-4">
        <li className="rounded border border-gray-300 bg-white p-4">
          <h2 className="text-lg font-semibold">
            <Link
              href="/settings/locations"
              className="inline-flex min-h-[44px] items-center text-blue-700 underline"
            >
              {t("locationsTitle")}
            </Link>
          </h2>
          <p className="mt-1 text-gray-700">{t("locationsDescription")}</p>
        </li>

        <li className="rounded border border-gray-300 bg-white p-4">
          <h2 className="text-lg font-semibold">
            <Link
              href="/settings/stores"
              className="inline-flex min-h-[44px] items-center text-blue-700 underline"
            >
              {t("storesTitle")}
            </Link>
          </h2>
          <p className="mt-1 text-gray-700">{t("storesDescription")}</p>
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">{t("languageTitle")}</h2>
      <p className="mt-2 text-gray-700">{t("languageDescription")}</p>

      <h2 className="mt-8 text-lg font-semibold">{t("pendingTitle")}</h2>
      <p className="mt-2 text-gray-700">{t("pendingDescription")}</p>
    </div>
  );
}
