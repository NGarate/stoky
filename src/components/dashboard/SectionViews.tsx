"use client";

import { useTranslations } from "next-intl";
import { ViewSwitch } from "@/components/ui/view-switch";
import { SECTIONS } from "./navigation";
import type { JSX } from "react";

/**
 * A section's two views, named from `SECTIONS`, so the words and the
 * addresses each come from one place for the four screens that draw them.
 */
export function SectionViews({
  section,
}: {
  section: keyof typeof SECTIONS;
}): JSX.Element {
  const t = useTranslations("navigation");
  const { labelKey, views } = SECTIONS[section];

  return (
    <ViewSwitch
      label={t("viewsOf", { section: t(labelKey) })}
      views={views.map((view) => ({
        href: view.href,
        label: t(view.labelKey),
      }))}
    />
  );
}
