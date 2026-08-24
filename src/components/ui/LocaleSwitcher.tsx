"use client";

import { useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { setLocalePreference } from "@/lib/i18n/cookies";
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
 *   `window.location.reload()`. The locale is read by the root layout on the
 *   server, so a refresh re-renders the tree with the new messages while
 *   leaving the client alive — someone half-way through registering keeps
 *   what they typed. A reload threw all of it away.
 *
 * The same control on `/login` and on `/settings`, writing to different
 * places without knowing it: `setLocalePreference` records the choice on the
 * account when there is one and on the device either way. That is what makes
 * this component usable before anybody has signed in, which is exactly where
 * a reader who cannot read the interface needs it.
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
      // Awaited: the refresh re-reads the preference on the server, so
      // refreshing before the action has written it renders the old language.
      await setLocalePreference(nextLocale);
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
