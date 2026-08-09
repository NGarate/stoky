/**
 * Theme preference — the shared vocabulary for the pre-paint script, the
 * control that writes it, and the tests that check both.
 *
 * `globals.css` declares dark twice: under `:root[data-theme="dark"]`, which
 * wins regardless of the system, and under `prefers-color-scheme: dark` scoped
 * to `:root:not([data-theme="light"])`, which is how an explicit light choice
 * switches the media query off. So the whole of "choose a theme" reduces to one
 * attribute on `<html>`:
 *
 *   system → no `data-theme` attribute (the media query decides)
 *   light  → `data-theme="light"`
 *   dark   → `data-theme="dark"`
 *
 * The choice is per device rather than per account: it is a property of the
 * screen you are looking at, not of who you are, and it has to work on `/login`
 * where there is no account yet.
 */

export const THEME_MODES = ["system", "light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export const DEFAULT_THEME_MODE: ThemeMode = "system";

/**
 * localStorage key. Deliberately not the design lab's `stoky-design-theme`:
 * the lab is gone, and a key naming a deleted surface would outlive whatever
 * explains it.
 */
export const THEME_STORAGE_KEY = "stoky-theme";

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" &&
    (THEME_MODES as readonly string[]).includes(value)
  );
}

/** Set (or clear) `data-theme` on `<html>`. Client only. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
}

/**
 * Read the stored choice, falling back to "system".
 *
 * Wrapped in try/catch because `localStorage` throws rather than returning null
 * when storage is disabled or the origin is opaque — a private-mode browser
 * should get the system theme, not a blank page.
 */
export function readStoredTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

/** Persist the choice. Failing to store is not worth breaking the click over. */
export function storeTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage unavailable; the theme still applies for this page.
  }
}

/* --------------------------------------------------------------------------
   A one-value store, so every control on the page shows the same answer.

   `/settings` renders the cluster while `DashboardNav` renders it too, and with
   the preference held in component state the two disagreed: choosing dark on
   the page turned the app dark while the control in the nav went on claiming
   "Sistema". A control that displays the wrong state is worse than no control,
   so the preference lives here and the components subscribe to it.
   -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);

  // A second tab writing the preference fires `storage` here — and only here,
  // never in the tab that wrote it — so this is also where that tab's document
  // has to catch up.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyTheme(readStoredTheme());
    listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Apply, persist and tell every subscribed control. */
export function setTheme(mode: ThemeMode): void {
  applyTheme(mode);
  storeTheme(mode);
  for (const listener of listeners) listener();
}

/**
 * `useSyncExternalStore` snapshots.
 *
 * The server cannot know the preference — it is in `localStorage`, which is why
 * the inline script exists — so it renders "system" and React corrects it after
 * hydration. Returning a plain string keeps the snapshot referentially stable,
 * which is what stops the re-render loop this hook is famous for.
 */
export function getThemeSnapshot(): ThemeMode {
  return readStoredTheme();
}

export function getServerThemeSnapshot(): ThemeMode {
  return DEFAULT_THEME_MODE;
}

/**
 * The pre-paint script, injected inline by the root layout.
 *
 * Inline by necessity. Anything with a `src` is fetched asynchronously, so the
 * document would paint with the system theme first and only then swap — a flash
 * of the wrong theme on every single load, which is worse than not offering the
 * choice. This runs synchronously as the parser reaches it, before the body is
 * painted, and it only touches an attribute, so there is nothing to hydrate.
 *
 * "system" writes nothing because the absence of the attribute *is* "system".
 *
 * The key is interpolated from the constant above rather than retyped, so the
 * script and `readStoredTheme` cannot drift apart. `JSON.stringify` is what
 * makes that interpolation safe to put inside a `<script>`.
 *
 * ES5 syntax and no dependencies: it runs before any bundle does.
 */
export const THEME_NO_FLASH_SCRIPT = `try {
  var m = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
  if (m === "light" || m === "dark") {
    document.documentElement.setAttribute("data-theme", m);
  }
} catch (e) {}`;
