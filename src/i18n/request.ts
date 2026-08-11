import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { resolveLocale } from "@/lib/i18n/locales";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();

  // Resolved, not trusted. The cookie is written by an unauthenticated server
  // action and can also be set by hand, and this value is interpolated into a
  // module path below. Validating at the point of *use* as well as at the
  // point of writing means an already-poisoned cookie — from before the
  // action was fixed, or set directly — cannot reach the import either.
  const locale = resolveLocale(cookieStore.get("locale")?.value);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
