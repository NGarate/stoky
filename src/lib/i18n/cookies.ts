"use server";

import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSupportedLocale } from "./locales";

/**
 * Record the chosen language: on the account when there is one, and on this
 * device either way.
 *
 * **Two places, because the language has to answer two different questions.**
 * `User.locale` is the answer to "what language does this person read", which
 * is a property of the person and has to follow them to the tablet in the
 * kitchen and to whatever they sign in on next. The cookie is the answer to
 * "what language should this browser render *right now*", which has to work
 * on `/login`, where there is no account to ask.
 *
 * The account wins when both exist — `src/i18n/request.ts` reads it first —
 * so the cookie is a device-level default rather than a second source of
 * truth. Writing it here anyway costs nothing and buys the signed-out case
 * and the render before the next request.
 *
 * The write is scoped to the caller's own row, from the session, and never to
 * an id the caller supplied. So this stays as safe as it was while it was
 * only touching a cookie.
 *
 * A `"use server"` action is a public HTTP endpoint, which makes the argument
 * attacker-chosen, and the value ends up interpolated into a dynamic
 * `import()` path in `src/i18n/request.ts`. So it is validated against the
 * shipped list rather than trusted. An unrecognised value is ignored rather
 * than rejected: nothing good comes of returning an error to a caller who was
 * never using the interface anyway, and the person using the switcher can only
 * send the two it offers.
 */
// Unauthenticated on purpose: the language switcher is reachable from the
// login page, so requiring a session would make it useless exactly where
// someone who cannot read the interface needs it. The rule is right that the
// argument is attacker-chosen — which is why it is validated against the
// shipped list below, and again where it is read (src/i18n/request.ts). All an
// anonymous caller can do is set its own cookie to one of two values.
// react-doctor-disable-next-line react-doctor/server-auth-actions
export async function setLocalePreference(locale: string) {
  if (!isSupportedLocale(locale)) return;

  const cookieStore = await cookies();
  cookieStore.set("locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "strict",
  });

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return;

  // `updateMany` rather than `update`: a session whose account has since been
  // deleted would make `update` throw P2025, and failing to record a
  // preference must not turn a language switch into an error page. Zero rows
  // updated is the right outcome there, and the cookie above already did the
  // part that person can still see.
  await prisma.user.updateMany({ where: { id: userId }, data: { locale } });
}
