"use client";

import { useId, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  getServerSnackbarDurationSnapshot,
  getSnackbarDurationSnapshot,
  setSnackbarDuration,
  SNACKBAR_DURATIONS,
  subscribeSnackbarDuration,
  type SnackbarDuration,
} from "@/lib/snackbar-duration";
import type { JSX } from "react";

/** Translation key per option, in `settings`. */
const LABEL_KEY: Record<
  SnackbarDuration,
  "snackbarDefault" | "snackbarLong" | "snackbarForever"
> = {
  default: "snackbarDefault",
  long: "snackbarLong",
  forever: "snackbarForever",
};

/**
 * How long a confirmation stays on screen.
 *
 * This control is the WCAG 2.2.1 answer for the snackbar. A message that
 * removes itself is a time limit, and the criterion asks that a time limit be
 * turn-off-able, adjustable or extendable. Pausing on hover and on focus —
 * which Radix does — serves the person who notices in time; this serves the
 * person who needs longer before the message even arrives, which is the case
 * pausing cannot reach. "Hasta descartar" is the turn-off.
 *
 * Built as the theme control is, and beside it, for the same three reasons: a
 * radio group rather than a toggle because there are three real choices, the
 * preference in an external store because two instances of the cluster share a
 * page, and the server rendering the default because `localStorage` does not
 * exist during a server render.
 */
export function SnackbarDurationControl(): JSX.Element {
  const t = useTranslations("settings");
  const groupName = useId();
  const value = useSyncExternalStore(
    subscribeSnackbarDuration,
    getSnackbarDurationSnapshot,
    getServerSnackbarDurationSnapshot,
  );

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-1 text-sm font-medium text-foreground">
        {t("snackbarDuration")}
      </legend>
      <div className="flex items-stretch gap-1 rounded-md border border-input p-1">
        {SNACKBAR_DURATIONS.map((option) => {
          const isSelected = value === option;
          return (
            <label
              key={option}
              className={`relative inline-flex min-h-[48px] min-w-[48px] cursor-pointer items-center justify-center rounded px-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
                isSelected
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <input
                type="radio"
                name={groupName}
                value={option}
                checked={isSelected}
                onChange={() => setSnackbarDuration(option)}
                className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded opacity-0"
              />
              <span className="pointer-events-none">{t(LABEL_KEY[option])}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
