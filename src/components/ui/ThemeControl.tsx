"use client";

import { useId, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  getServerThemeSnapshot,
  getThemeSnapshot,
  setTheme,
  subscribeTheme,
  THEME_MODES,
  type ThemeMode,
} from "@/lib/theme";
import { RadioOption } from "@/components/ui/radio-option";
import type { JSX } from "react";

/** Translation key per mode, in `settings`. */
const LABEL_KEY: Record<ThemeMode, "themeSystem" | "themeLight" | "themeDark"> =
  {
    system: "themeSystem",
    light: "themeLight",
    dark: "themeDark",
  };

/**
 * System / Light / Dark selector.
 *
 * A radio group rather than a two-state switch. A toggle destroys "follow my
 * system" the moment it is first touched, and that is the setting most people
 * actually want — it is the one that tracks their phone going dark at night
 * without them doing anything (DESIGN_AUDIT A1.1).
 *
 * The stored choice is applied before paint by the inline script in the root
 * layout, so this component's job at mount is only to make the control agree
 * with what the script already did. It renders "system" on the server and
 * `useSyncExternalStore` swaps in the real value after hydration, because
 * `localStorage` does not exist during the server render and guessing at it
 * would be a hydration mismatch.
 *
 * That store is also what keeps two instances honest: `/settings` renders the
 * cluster while the nav above it renders another, and the preference has to be
 * one value rather than two copies.
 *
 * Selection is shown by weight as well as fill, so the current mode is not
 * conveyed by colour alone, and each option is a 48px target — the AAA
 * minimum of 44 (2.5.5), raised to the phone tier's thumb floor (DESIGN_AUDIT
 * A4.2).
 */
export function ThemeControl(): JSX.Element {
  const t = useTranslations("settings");
  // Radios group by `name`, and two instances do share a page. A hardcoded
  // name would merge them into one native group, so a click on the page's
  // control would fire an unwanted change on the nav's.
  const groupName = useId();
  const mode = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-1 text-sm font-medium text-foreground">
        {t("theme")}
      </legend>
      <div className="flex items-stretch gap-1 rounded-md border border-input p-1">
        {THEME_MODES.map((value) => (
          <RadioOption
            checked={mode === value}
            key={value}
            name={groupName}
            onSelect={() => setTheme(value)}
            value={value}
          >
            {t(LABEL_KEY[value])}
          </RadioOption>
        ))}
      </div>
    </fieldset>
  );
}
