"use client";

import { ItemRow } from "@/components/ui/item-row";
import { useTranslations } from "next-intl";
import { Section, sectionHeading } from "@/components/ui/section";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { PreferencesCluster } from "@/components/ui/PreferencesCluster";
import { SnackbarDurationControl } from "@/components/ui/SnackbarDurationControl";
import { ExportButton } from "@/components/settings/ExportButton";
import { SignOutButton } from "@/components/session/SignOutButton";
import { RevokeSessionsButton } from "@/components/session/RevokeSessionsButton";
import { ChangePasswordForm } from "@/components/session/ChangePasswordForm";
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
 * It is now the *only* surface that renders them. `DashboardNav` and
 * `NavSheet` rendered the cluster too, so three settings controls sat on every
 * signed-in route; both link here instead.
 *
 * The three controls do not all store their answer in the same place, and the
 * copy under the heading says which is which — because "why is the app in
 * English on my phone but Spanish on the tablet" is a question somebody will
 * otherwise have to guess the answer to. Theme is the device's, language and
 * the confirmation duration are the account's.
 *
 * What it still does not do, on purpose: household, profile and notification
 * settings. The `settings.household`, `settings.profile` and
 * `settings.notifications` strings exist in both catalogues, but no procedure
 * backs any of them.
 */
export default function SettingsPage(): JSX.Element {
  const t = useTranslations("settings.hub");
  const tHousehold = useTranslations("household");
  const tOffline = useTranslations("offline");
  const tStart = useTranslations("start");
  const tPassword = useTranslations("password");

  return (
    <PageShell width="form">
      <PageHeader intro={t("intro")} title={t("title")} />

      {/* Each screen is one ItemRow whose title is the link. They were cards
          whose h2 held a link-styled Button — so the title, at the
          button's text-sm, rendered smaller than the sentence under it, and
          five h2s were spent on what is a list of places to go. */}
      <ul className="space-y-3">
        <ItemRow
          description={t("locationsDescription")}
          href="/settings/locations"
          title={t("locationsTitle")}
        />
        <ItemRow
          description={t("storesDescription")}
          href="/settings/stores"
          title={t("storesTitle")}
        />
        <ItemRow
          description={tHousehold("peopleDescription")}
          href="/settings/people"
          title={tHousehold("peopleTitle")}
        />
        <ItemRow
          description={tStart("settingsLinkDescription")}
          href="/settings/screen"
          title={tStart("settingsLink")}
        />
        <ItemRow
          description={tOffline("unsavedDescription")}
          href="/settings/unsaved"
          title={tOffline("unsavedTitle")}
        />
      </ul>

      {/* Not in the list above, because it is an action rather than a screen —
          and above sign-out, because leaving with your data is the step that
          has to come first. */}
      <section className="mt-8 rounded border border-border bg-card p-4">
        <ExportButton />
      </section>

      {/* The two actions that end the visit, cheapest first — and both
          first-class, because on a shared device they are the controls that
          matter most.

          Two sections rather than one, so the expensive one is never a mis-tap
          away from the routine one: signing out ends this device's visit, and
          the second makes every device this account is signed in on ask for a
          password again. Their copy carries that distinction; neither restates
          the other's. */}
      <section className="mt-8 rounded border border-border bg-card p-4">
        <SignOutButton />
      </section>

      <section className="mt-4 rounded border border-border bg-card p-4">
        <RevokeSessionsButton />
      </section>

      {/* Beside the session controls because it is one: changing the password
          ends every session the account has, this one included, and the
          person who suspects a leak needs both in the same place. A form
          rather than a link to a screen of its own, because it is three
          fields and a button. */}
      <Section
        className="mt-4 rounded border border-border bg-card p-4"
        title={tPassword("title")}
      >
        <ChangePasswordForm />
      </Section>

      {/* The only place in the application these are offered. They used to be
          in the top bar and in the "Más" sheet as well, which put settings
          controls across the top of every screen — including the household
          overview, whose whole job is what to buy and what is running out. */}
      <h2 className={`mt-8 ${sectionHeading()}`}>
        {t("preferencesTitle")}
      </h2>
      <p className="mt-2 text-muted-foreground">{t("preferencesDescription")}</p>
      <PreferencesCluster className="mt-4" />

      {/* Beside the cluster rather than inside it: this one needs an account
          to write to, and the cluster is also rendered on `/login`.

          `mt-3` is the cluster's own `gap-y-3`, restated because this control
          is outside it. Without it the two sat flush — measured at 1280px,
          "Tema" ended and "Duración de los avisos" began on the same pixel —
          so three controls of one kind read as two groups with a seam. */}
      <SnackbarDurationControl className="mt-3" />
    </PageShell>
  );
}
