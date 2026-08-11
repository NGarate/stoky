"use server";

import { cookies } from "next/headers";
import { isSupportedLocale } from "./locales";

/**
 * Set the language cookie.
 *
 * A `"use server"` action is a public HTTP endpoint. This one is
 * unauthenticated on purpose — switching language should not need an account —
 * which makes its argument attacker-chosen, and the value ends up interpolated
 * into a dynamic `import()` path in `src/i18n/request.ts`.
 *
 * So it is validated against the shipped list rather than trusted. An
 * unrecognised value is ignored rather than rejected: nothing good comes of
 * returning an error to a caller who was never using the interface anyway, and
 * the person using the switcher can only send the two it offers.
 */
export async function setLocaleCookie(locale: string) {
  if (!isSupportedLocale(locale)) return;

  const cookieStore = await cookies();
  cookieStore.set("locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "strict",
  });
}
