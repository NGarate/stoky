"use client";

import { useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { setLocaleCookie } from "@/lib/i18n/cookies";
import type { ChangeEvent, JSX } from "react";

/**
 * Language selector.
 *
 * Kept as a native `<select>` on purpose: it is keyboard- and
 * screen-reader-correct for free, and on a phone it opens the platform picker
 * rather than a list nobody styled for a thumb.
 *
 * Two defects from DESIGN_AUDIT §2 are fixed here:
 *
 * - The id came from `useId()` instead of the literal `id="locale-switcher"`.
 *   The literal meant a second instance on one page produced two elements with
 *   the same id, and `<label for>` would then name the wrong one — which is
 *   why `/settings` linked to the switcher in the nav instead of rendering it.
 * - The locale is applied with `router.refresh()` rather than
 *   `window.location.reload()`. The locale lives in a cookie read by the root
 *   layout on the server, so a refresh re-renders the tree with the new
 *   messages while leaving the client alive — someone half-way through
 *   registering keeps what they typed. A reload threw all of it away.
 */
export function LocaleSwitcher(): JSX.Element {
  const t = useTranslations("settings");
  const locale = useLocale();
  const router = useRouter();
  const selectId = useId();
  const [isPending, startTransition] = useTransition();

  function onSelectChange(event: ChangeEvent<HTMLSelectElement>): void {
    const nextLocale = event.target.value;
    startTransition(async () => {
      // Awaited: the refresh re-reads the cookie on the server, so refreshing
      // before the server action has written it renders the old language.
      await setLocaleCookie(nextLocale);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="text-sm font-medium text-foreground">
        {t("language")}
      </label>
      <select
        id={selectId}
        defaultValue={locale}
        disabled={isPending}
        onChange={onSelectChange}
        className="min-h-[48px] rounded-md border border-input bg-card px-3 text-sm text-foreground"
      >
        <option value="es">{t("spanish")}</option>
        <option value="en">{t("english")}</option>
      </select>
    </div>
  );
}
