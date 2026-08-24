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
import { api } from "@/lib/trpc/client";
import { RadioOption } from "@/components/ui/radio-option";
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
 * page, and the server rendering the default because there is no device cache
 * to read during a server render.
 *
 * **Where it differs from the theme: this one belongs to the account.** The
 * theme is a property of the screen you are looking at; this is a property of
 * how long you need to read something, which does not change when you pick up
 * a different device. So the choice is applied locally at once — the reader
 * gets no spinner for a preference — and sent to the server after, and the
 * store is re-seeded from the account on the next load either way.
 *
 * Nothing is said when the write fails. The setting has still taken effect on
 * this device, the reader can see that it has, and a red message about a
 * preference is a worse outcome than a preference that has to be set again on
 * the next machine. It is the one place in this application where a failed
 * write is deliberately quiet, which is why that is written down here.
 *
 * Consequently this control is only rendered where there is an account:
 * `/settings`, and not `/login` or `/register`. `PreferencesCluster` carries
 * the two that work signed out.
 */
export function SnackbarDurationControl({
  className = "",
}: {
  className?: string;
} = {}): JSX.Element {
  const t = useTranslations("settings");
  const groupName = useId();
  const value = useSyncExternalStore(
    subscribeSnackbarDuration,
    getSnackbarDurationSnapshot,
    getServerSnackbarDurationSnapshot,
  );
  const remember = api.auth.setSnackbarDuration.useMutation();

  function choose(next: SnackbarDuration): void {
    // Local first, and unconditionally: the reader sees the choice take effect
    // whether or not the server is reachable.
    setSnackbarDuration(next);
    remember.mutate({ snackbarDuration: next });
  }

  return (
    <fieldset className={`min-w-0 border-0 p-0 ${className}`}>
      <legend className="mb-1 text-sm font-medium text-foreground">
        {t("snackbarDuration")}
      </legend>
      <div className="flex items-stretch gap-1 rounded-md border border-input p-1">
        {SNACKBAR_DURATIONS.map((option) => (
          <RadioOption
            checked={value === option}
            key={option}
            name={groupName}
            onSelect={() => choose(option)}
            value={option}
          >
            {t(LABEL_KEY[option])}
          </RadioOption>
        ))}
      </div>
    </fieldset>
  );
}
