"use client";

import { useEffect } from "react";
import { hydrateSnackbarDuration } from "@/lib/snackbar-duration";
import type { JSX } from "react";

/**
 * Hands the account's display preferences to the stores that hold them.
 *
 * The snackbar duration is an account setting (WCAG 2.2.1 is about the person,
 * not the browser), but the thing that reads it — `SnackbarProvider` — is deep
 * in the client and runs on every screen. Making it ask the server would put a
 * query behind every snackbar and a loading state behind a preference.
 *
 * So the shell reads it once, on the server, where it has already awaited the
 * session anyway, and this component pushes it into the store. It renders
 * nothing.
 *
 * An effect rather than a render-time call: writing to a module-level store
 * during render is a side effect in a place React is allowed to run twice, and
 * `useSyncExternalStore` would be told its snapshot changed mid-render.
 * `hydrateSnackbarDuration` is a no-op when the value already matches, so the
 * effect settles after one pass.
 *
 * The theme is not here and should not be. It is a property of the screen,
 * lives in `localStorage`, and is applied before paint by the inline script in
 * the root layout — a round trip through the server would be a flash of the
 * wrong theme on every load.
 */
export function PreferencesSync({
  snackbarDuration,
}: {
  /** `User.snackbarDuration`, straight from the row. Validated on arrival. */
  snackbarDuration: string;
}): JSX.Element | null {
  useEffect(() => {
    hydrateSnackbarDuration(snackbarDuration);
  }, [snackbarDuration]);

  return null;
}
