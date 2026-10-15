"use client";

import { useTranslations } from "next-intl";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { DeviceList } from "@/components/session/DeviceList";
import { ChangePasswordForm } from "@/components/session/ChangePasswordForm";
import type { JSX } from "react";

/**
 * Security and access: where this account is signed in, the way to end any
 * of it (ASVS 5.0.0 7.5.2, PROGRESS D143), and the way to change the password.
 *
 * A client page like the rest of the dashboard (`CLAUDE.md`, offline), and a
 * screen of its own rather than a section of the settings hub, because the
 * list grows with the household's devices and each row carries an action.
 * The person who has lost a phone is sent here by the hub's
 * "Seguridad y acceso" row.
 *
 * Nothing on it is persisted for offline reading: a list of sessions read
 * from a cache would offer to end sessions that may already have ended, and
 * every action needs the server anyway.
 *
 * The password form moved here from the hub because it ends sessions too —
 * every one the account has, today this device's included — so it belongs
 * beside the list of what it would end. After the list, because the list is
 * what the person who has lost a phone comes for.
 */
export default function SecurityPage(): JSX.Element {
  const t = useTranslations("security");
  const tPassword = useTranslations("password");

  return (
    <PageShell width="form">
      <PageHeader
        back={{ href: "/settings", label: t("backToSettings") }}
        intro={t("intro")}
        title={t("title")}
      />

      <Section title={t("devicesTitle")}>
        <DeviceList />
      </Section>

      <Section className="mt-8" title={tPassword("title")}>
        <ChangePasswordForm />
      </Section>
    </PageShell>
  );
}
