import { prisma } from "@/lib/prisma";
import { BRAND } from "@/lib/route-titles";

interface HouseholdNames {
  name: string;
  tabName: string | null;
  appName: string | null;
}

/**
 * What the browser tab and the installed app are called, with the owner's
 * defaults (plan 2026-11-12, §2): an unnamed tab says `Stoky` — never the
 * household's name — and an unnamed app takes the household's name, or
 * `Stoky` before the first registration has made a household.
 *
 * Both are served without a session (the tab on `/login`, the manifest), so
 * whatever these return is public: SECURITY.md.
 */
export function installationNames(household: HouseholdNames | null): {
  tab: string;
  app: string;
} {
  return {
    tab: household?.tabName ?? BRAND,
    app: household?.appName ?? household?.name ?? BRAND,
  };
}

/**
 * The names of the installation's household. An installation holds one; a
 * database edited by hand to hold several answers with the oldest.
 *
 * Not cached: its readers (the root layout, the manifest) already render per
 * request, and a rename then shows on the next render with nothing to
 * invalidate.
 *
 * `find` is the query, a parameter so a test can make it fail.
 */
export async function readInstallationNames(
  find: () => Promise<HouseholdNames | null> = () =>
    prisma.household.findFirst({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { name: true, tabName: true, appName: true },
    }),
): Promise<{ tab: string; app: string }> {
  try {
    return installationNames(await find());
  } catch {
    // The root layout renders every route, /login and /offline included: a
    // database that is down costs the names, not the page (`accountLocale`).
    return installationNames(null);
  }
}
