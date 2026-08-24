import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { preferredLocale } from "@/lib/i18n/locales";

/**
 * Which language to render in, and where that answer comes from.
 *
 * **The account first, the device second.** `User.locale` has existed since
 * the first migration and nothing ever read it: the language was a cookie, so
 * it was a property of the browser rather than of the person. Two people
 * sharing the kitchen tablet shared a language, and signing in somewhere new
 * meant setting it again. The account is asked first, so the preference
 * follows whoever is signed in.
 *
 * The cookie stays, and not as an apology. It is the only answer available on
 * `/login` and `/register`, where there is no account to ask and where someone
 * who cannot read the interface most needs to change it.
 * `setLocalePreference` writes both.
 *
 * **The lookup is allowed to fail.** This runs for every render of every
 * route, the error boundaries included, so a database that is down has to
 * degrade to the cookie rather than take the whole application with it. That
 * costs one request rendered in a language somebody did not choose; the
 * alternative is no page at all.
 *
 * Whatever it lands on is resolved, not trusted. The cookie is written by an
 * unauthenticated server action and can also be set by hand, and this value is
 * interpolated into a module path below. Validating at the point of *use* as
 * well as at the point of writing means an already-poisoned cookie — from
 * before the action was fixed, or set directly — cannot reach the import
 * either.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = preferredLocale(
    await accountLocale(),
    cookieStore.get("locale")?.value,
  );

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});

/** The signed-in account's language, or `null` for "nobody, or could not ask". */
async function accountLocale(): Promise<string | null> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return null;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });

    return user?.locale ?? null;
  } catch {
    // See the docblock: the page renders in the device's language rather than
    // not at all.
    return null;
  }
}
