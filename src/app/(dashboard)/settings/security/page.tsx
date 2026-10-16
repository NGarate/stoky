"use client";

import { useTranslations } from "next-intl";
import { PageHeader, PageShell } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { DeviceList } from "@/components/session/DeviceList";
import { ChangePasswordForm } from "@/components/session/ChangePasswordForm";
import { TwoFactorSettings } from "@/components/security/TwoFactorSettings";
import { PasskeyManager } from "@/components/security/PasskeyManager";
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
 * every one the account has but this device's, which carries on under a new
 * token (D144) — so it belongs beside the list of what it would end, and the
 * list is read again when it is done. After the list, because the list is
 * what the person who has lost a phone comes for.
 *
 * Two-step verification comes last (D148): turning it on is a choice made
 * once, and every change to it ends with a pointer back up to the devices
 * list (ASVS 5.0.0 7.4.3), which is why that section's heading has an id.
 * Shown to every role, the kitchen's shared account included.
 *
 * Passkeys after it (D151): another way in, added or removed with the
 * password like the second step, and the section that most often has to say
 * why it cannot be used here — at a second address, or on an install that
 * cannot have them. Every role, too.
 */
export default function SecurityPage(): JSX.Element {
  const t = useTranslations("security");
  const tPassword = useTranslations("password");
  const tTwoFactor = useTranslations("auth");

  return (
    <PageShell width="form">
      <PageHeader
        back={{ href: "/settings", label: t("backToSettings") }}
        intro={t("intro")}
        title={t("title")}
      />

      <Section id="devices" title={t("devicesTitle")}>
        <DeviceList />
      </Section>

      <Section className="mt-8" title={tPassword("title")}>
        <ChangePasswordForm />
      </Section>

      <Section className="mt-8" title={tTwoFactor("twoFactorTitle")}>
        <TwoFactorSettings />
      </Section>

      <Section className="mt-8" title={t("passkeysTitle")}>
        <PasskeyManager />
      </Section>
    </PageShell>
  );
}
