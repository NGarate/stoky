"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { setLocaleCookie } from "@/lib/i18n/cookies";

export function LocaleSwitcher() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  function onSelectChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextLocale = event.target.value;
    startTransition(() => {
      setLocaleCookie(nextLocale);
      window.location.reload();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="locale-switcher" className="text-sm font-medium">
        {t("language")}
      </label>
      <select
        id="locale-switcher"
        defaultValue={locale}
        disabled={isPending}
        onChange={onSelectChange}
        className="rounded-md border border-gray-300 px-3 py-1 text-sm focus:border-blue-500 focus:outline-none"
      >
        <option value="es">{t("spanish")}</option>
        <option value="en">{t("english")}</option>
      </select>
    </div>
  );
}
