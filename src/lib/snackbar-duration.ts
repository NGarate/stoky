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
 * **Per account, not per device.** It was `localStorage` only, which made a
 * 2.2.1 adjustment a property of the browser: somebody who needs longer to
 * read a message had to say so again on the phone, again on the kitchen
 * tablet, and lost it whenever storage was cleared. The criterion is about the
 * person, so the account is where the answer lives (`auth.setSnackbarDuration`).
 *
 * The device still keeps a copy, and that copy has one job: to be right on the
 * first paint, before the account's value has arrived. It is a cache, not a
 * second source of truth — `hydrateSnackbarDuration` overwrites it with the
 * account's answer on every load, so the two cannot drift.
 *
 * The theme deliberately did *not* come with it. That one really is a property
 * of the screen you are looking at, and it has to work on `/login` where there
 * is no account; `src/lib/theme.ts` says so at more length.
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

   Held in a variable rather than read back out of `localStorage` on every
   snapshot, which is what it used to do. Storage can no longer be the answer:
   the account is, and the account's value arrives after the first render. A
   snapshot that reads storage would go on reporting the device's cache for
   ever, and `useSyncExternalStore` would never be told anything had changed.
   -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

/**
 * The current value.
 *
 * Seeded from the device's cache on the client, so the first paint is right,
 * and left at the default on the server, where there is no storage to read.
 * `hydrateSnackbarDuration` replaces it with the account's answer.
 */
let current: SnackbarDuration =
  typeof window === "undefined"
    ? DEFAULT_SNACKBAR_DURATION
    : readStoredSnackbarDuration();

function announce(): void {
  for (const listener of listeners) listener();
}

export function subscribeSnackbarDuration(listener: () => void): () => void {
  listeners.add(listener);

  // A second tab writing the cache fires `storage` here — and only here, never
  // in the tab that wrote it. Both tabs are the same account, so the value it
  // carries is the account's; taking it saves a round trip and keeps two open
  // tabs agreeing.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== SNACKBAR_DURATION_STORAGE_KEY) return;
    current = readStoredSnackbarDuration();
    listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The account's answer, on load.
 *
 * Separate from `setSnackbarDuration` because it must not write back: this is
 * the server telling the client what is already stored, and sending it
 * straight back would be a mutation on every page load.
 */
export function hydrateSnackbarDuration(value: unknown): void {
  const next = isSnackbarDuration(value) ? value : DEFAULT_SNACKBAR_DURATION;
  if (next === current) return;

  current = next;
  // The device cache follows the account, so the next first paint — before
  // this function has run again — starts from the right place.
  storeSnackbarDuration(next);
  announce();
}

/**
 * The reader chose. Applied immediately and cached on the device; the caller
 * is responsible for telling the account, because only it knows whether the
 * write was accepted.
 */
export function setSnackbarDuration(value: SnackbarDuration): void {
  current = value;
  storeSnackbarDuration(value);
  announce();
}

export function getSnackbarDurationSnapshot(): SnackbarDuration {
  return current;
}

export function getServerSnackbarDurationSnapshot(): SnackbarDuration {
  return DEFAULT_SNACKBAR_DURATION;
}
