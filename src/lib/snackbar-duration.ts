/**
 * How long a snackbar stays — the WCAG 2.2.1 answer, and the shared
 * vocabulary between the control that writes it and the provider that reads
 * it.
 *
 * A message that removes itself after four seconds is a time limit, and 2.2.1
 * (Level A) asks that a time limit be turn-off-able, adjustable or extendable.
 * Radix's pause-on-hover, pause-on-focus and pause-while-hidden cover the
 * "extend" case for someone who notices in time; this covers the person who
 * needs longer *before* the message arrives, which is the case pausing cannot
 * serve.
 *
 * `forever` is the turn-off: the snackbar waits to be dismissed. It is not the
 * default because a snackbar that never leaves is a banner, and the shell
 * already has two of those.
 *
 * Per device rather than per account, for the same reason the theme is: it is
 * a property of how you are reading this screen right now.
 *
 * The undo snackbar is the one exception, and the provider enforces it: its
 * life is the queue's hold window, because the button stops working when the
 * window closes and offering a button that does nothing is worse than offering
 * none. Under 2.2.1 that duration is essential — extending it would invalidate
 * the activity.
 */

export const SNACKBAR_DURATIONS = ["default", "long", "forever"] as const;

export type SnackbarDuration = (typeof SNACKBAR_DURATIONS)[number];

export const DEFAULT_SNACKBAR_DURATION: SnackbarDuration = "default";

export const SNACKBAR_DURATION_STORAGE_KEY = "stoky-snackbar-duration";

/** Milliseconds, or `null` for "wait to be dismissed". */
export const DURATION_MS: Record<SnackbarDuration, number | null> = {
  // Material's own default, and long enough to read a sentence of six words.
  default: 6_000,
  long: 15_000,
  forever: null,
};

export function isSnackbarDuration(value: unknown): value is SnackbarDuration {
  return (
    typeof value === "string" &&
    (SNACKBAR_DURATIONS as readonly string[]).includes(value)
  );
}

/**
 * Wrapped in try/catch for the same reason `readStoredTheme` is: storage
 * throws rather than returning null when it is disabled or the origin is
 * opaque, and a private-mode browser should get the default, not a crash.
 */
export function readStoredSnackbarDuration(): SnackbarDuration {
  try {
    const stored = window.localStorage.getItem(SNACKBAR_DURATION_STORAGE_KEY);
    return isSnackbarDuration(stored) ? stored : DEFAULT_SNACKBAR_DURATION;
  } catch {
    return DEFAULT_SNACKBAR_DURATION;
  }
}

export function storeSnackbarDuration(value: SnackbarDuration): void {
  try {
    window.localStorage.setItem(SNACKBAR_DURATION_STORAGE_KEY, value);
  } catch {
    // Storage unavailable; the choice still applies for this page.
  }
}

/* --------------------------------------------------------------------------
   One value, so every control on the page shows the same answer — the same
   store the theme preference keeps, and for the same reason.
   -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

export function subscribeSnackbarDuration(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== SNACKBAR_DURATION_STORAGE_KEY) return;
    listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setSnackbarDuration(value: SnackbarDuration): void {
  storeSnackbarDuration(value);
  for (const listener of listeners) listener();
}

export function getSnackbarDurationSnapshot(): SnackbarDuration {
  return readStoredSnackbarDuration();
}

export function getServerSnackbarDurationSnapshot(): SnackbarDuration {
  return DEFAULT_SNACKBAR_DURATION;
}
