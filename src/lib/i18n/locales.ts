/**
 * The languages this application ships, in one place.
 *
 * There was no such place: the switcher hardcoded two `<option>` values, the
 * request config defaulted to `"es"` and accepted anything else, and the server
 * action that wrote the cookie took a bare `string`. Three copies of a fact,
 * none of them checked against the others.
 *
 * It matters more than tidiness because of where the value ends up.
 * `src/i18n/request.ts` interpolates it into a dynamic `import()` path, and the
 * action that sets it is unauthenticated by design — a language switch should
 * not need an account. So the value is attacker-chosen, and the only thing
 * standing between it and a module path is this list.
 */

export const LOCALES = ["es", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** Spanish. `REDESIGN_PLAN.md` §5.6: the primary language, not a fallback. */
export const DEFAULT_LOCALE: Locale = "es";

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The locale to use for a value that came from outside — a cookie, a form, a
 * query string. Anything unrecognised becomes the default rather than an
 * error: a stale or tampered cookie should give someone Spanish, not a 500.
 */
export function resolveLocale(value: unknown): Locale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * The language to render in, given what the account says and what the device
 * says.
 *
 * **The account wins.** `User.locale` is a property of the person and has to
 * follow them to the kitchen tablet and to whatever they sign in on next; the
 * cookie is a property of one browser. Two people sharing a device shared a
 * language while the cookie was the only answer.
 *
 * The device is not merely a fallback for the signed-out case, though that is
 * where it matters most — `/login` has no account to ask, and that is exactly
 * where somebody who cannot read the interface needs the switcher. It is also
 * what answers while the account's value is unreadable: an account carrying a
 * language this build no longer ships is a stale row, not a reason to ignore
 * the perfectly good preference sitting on the device.
 *
 * Both are resolved rather than trusted. The value ends up interpolated into a
 * dynamic `import()` in `src/i18n/request.ts`, and while the cookie is the
 * attacker-reachable one, a column edited by hand deserves the same treatment
 * — a check that only guards the input you thought of is the one that gets
 * bypassed.
 */
export function preferredLocale(account: unknown, device: unknown): Locale {
  if (isSupportedLocale(account)) return account;
  return resolveLocale(device);
}
