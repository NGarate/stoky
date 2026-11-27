"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ItemRow } from "@/components/ui/item-row";
import { Input } from "@/components/ui/input";
import { sectionHeading } from "@/components/ui/section";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { foldText } from "@/components/ui/combobox";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { ThemeControl } from "@/components/ui/ThemeControl";
import { SnackbarDurationControl } from "@/components/ui/SnackbarDurationControl";
import { ExportButton } from "@/components/settings/ExportButton";
import { HouseholdSettings } from "@/components/settings/HouseholdSettings";
import { api } from "@/lib/trpc/client";
import type { JSX, ReactNode } from "react";

/** One setting: the words it is found by, and what it draws. */
interface Setting {
  key: string;
  words: readonly string[];
  node: ReactNode;
}

interface Group {
  key: string;
  title: string;
  description?: string;
  settings: readonly Setting[];
}

/** A control drawn in place, on the same card a row of the list wears. */
const CONTROL_CARD = "rounded-lg border border-border bg-card p-4 shadow-sm";

/**
 * Configuración, ordered by what somebody came to do (`DECISIONS.md`
 * NAVIGATION, owner, 2026-11-27): organise the house, how it looks and how
 * it tells you things, security, your data — with a search field above,
 * for whoever does not know what the thing they want is called.
 *
 * The same settings as before, neither more nor fewer: the screens it links
 * to, and the controls it draws in place. Only their order changed. It used
 * to be one flat list that mixed what belongs to the account, to the device
 * and to the household, with two actions between them. Signing out was one
 * of those, and is not here any more: it is in the account panel, which
 * every tier opens from every screen.
 *
 * The search filters as you type, without accents or capitals in the way,
 * by each setting's name and the sentence under it and by its group's name;
 * a group with nothing left in it goes. What it found is said in words in a
 * status region, so a screen reader hears when nothing matches.
 *
 * The household's own settings, its names, are drawn only to an owner or an
 * admin (`HouseholdSettings`), so only they can find them. What it still
 * does not do, on purpose: profile and notification settings. No procedure
 * backs either.
 */
export default function SettingsPage(): JSX.Element {
  const t = useTranslations("settings.hub");
  const tSettings = useTranslations("settings");
  const tHousehold = useTranslations("household");
  const tOffline = useTranslations("offline");
  const tStart = useTranslations("start");
  const tSecurity = useTranslations("security");
  const searchId = useId();
  const [query, setQuery] = useState("");

  const role = api.household.current.useQuery().data?.role;
  const canManageHousehold = role === "OWNER" || role === "ADMIN";

  const groups: readonly Group[] = [
    {
      key: "house",
      title: t("groupHouse"),
      settings: [
        ...(canManageHousehold
          ? [
              {
                key: "household",
                words: [
                  tHousehold("settingsTitle"),
                  tHousehold("nameLabel"),
                  tHousehold("tabNameLabel"),
                  tHousehold("appNameLabel"),
                ],
                node: (
                  <li key="household">
                    <HouseholdSettings />
                  </li>
                ),
              },
            ]
          : []),
        {
          key: "people",
          words: [tHousehold("peopleTitle"), tHousehold("peopleDescription")],
          node: (
            <ItemRow
              description={tHousehold("peopleDescription")}
              href="/settings/people"
              key="people"
              title={tHousehold("peopleTitle")}
            />
          ),
        },
        {
          key: "locations",
          words: [t("locationsTitle"), t("locationsDescription")],
          node: (
            <ItemRow
              description={t("locationsDescription")}
              href="/settings/locations"
              key="locations"
              title={t("locationsTitle")}
            />
          ),
        },
        {
          key: "stores",
          words: [t("storesTitle"), t("storesDescription")],
          node: (
            <ItemRow
              description={t("storesDescription")}
              href="/settings/stores"
              key="stores"
              title={t("storesTitle")}
            />
          ),
        },
      ],
    },
    {
      key: "look",
      title: t("groupLook"),
      // Which of these is the account's and which the device's, because
      // "why is the app in English on my phone but Spanish on the tablet" is
      // a question somebody will otherwise have to guess the answer to.
      description: t("preferencesDescription"),
      settings: [
        {
          key: "language",
          words: [tSettings("language")],
          node: (
            <li className={CONTROL_CARD} key="language">
              <LocaleSwitcher />
            </li>
          ),
        },
        {
          key: "snackbar",
          words: [
            tSettings("snackbarDuration"),
            tSettings("snackbarDurationHint"),
          ],
          node: (
            <li className={CONTROL_CARD} key="snackbar">
              <SnackbarDurationControl />
            </li>
          ),
        },
        {
          key: "theme",
          words: [tSettings("theme")],
          node: (
            <li className={CONTROL_CARD} key="theme">
              <ThemeControl />
            </li>
          ),
        },
        {
          key: "screen",
          words: [tStart("settingsLink"), tStart("settingsLinkDescription")],
          node: (
            <ItemRow
              description={tStart("settingsLinkDescription")}
              href="/settings/screen"
              key="screen"
              title={tStart("settingsLink")}
            />
          ),
        },
      ],
    },
    {
      key: "security",
      title: t("groupSecurity"),
      settings: [
        {
          key: "security",
          words: [tSecurity("title"), tSecurity("hubDescription")],
          node: (
            <ItemRow
              description={tSecurity("hubDescription")}
              href="/settings/security"
              key="security"
              title={tSecurity("title")}
            />
          ),
        },
      ],
    },
    {
      key: "data",
      title: t("groupData"),
      settings: [
        {
          key: "unsaved",
          words: [tOffline("unsavedTitle"), tOffline("unsavedDescription")],
          node: (
            <ItemRow
              description={tOffline("unsavedDescription")}
              href="/settings/unsaved"
              key="unsaved"
              title={tOffline("unsavedTitle")}
            />
          ),
        },
        {
          key: "export",
          words: [t("exportTitle"), t("exportDescription")],
          node: (
            <li className={CONTROL_CARD} key="export">
              <ExportButton />
            </li>
          ),
        },
      ],
    },
  ];

  const wanted = foldText(query);
  const shown = groups
    .map((group) => ({
      ...group,
      settings: group.settings.filter(
        (setting) =>
          wanted === "" ||
          [group.title, ...setting.words].some((word) =>
            foldText(word).includes(wanted),
          ),
      ),
    }))
    .filter((group) => group.settings.length > 0);
  const found = shown.reduce((sum, group) => sum + group.settings.length, 0);

  return (
    <PageShell width="form">
      {/* Back to Inicio: no bar marks Configuración, so the title and this
          link say where you are (DECISIONS.md NAVIGATION). */}
      <PageHeader back="/dashboard" intro={t("intro")} title={t("title")} />

      <div role="search">
        <label
          className="mb-1 block text-sm font-medium text-foreground"
          htmlFor={searchId}
        >
          {t("search")}
        </label>
        <Input
          autoComplete="off"
          id={searchId}
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          value={query}
        />
      </div>

      {/* Present from the first render, so what it says when the search
          changes is announced rather than appearing in a region created at
          that moment. Silent while nothing is being searched. */}
      <p className="sr-only" role="status">
        {wanted === "" ? "" : t("searchFound", { count: found })}
      </p>

      {shown.length === 0 ? (
        <p className="mt-6 text-muted-foreground">
          {t("searchEmpty", { query: query.trim() })}
        </p>
      ) : null}

      {shown.map((group) => (
        <section
          aria-labelledby={`settings-${group.key}`}
          className="mt-8"
          key={group.key}
        >
          <h2 className={sectionHeading()} id={`settings-${group.key}`}>
            {group.title}
          </h2>
          {group.description ? (
            <p className="mt-2 text-muted-foreground">{group.description}</p>
          ) : null}
          <ul className="mt-4 space-y-3">
            {group.settings.map((setting) => setting.node)}
          </ul>
        </section>
      ))}
    </PageShell>
  );
}
