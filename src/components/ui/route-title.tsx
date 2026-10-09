"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { documentTitle, titleKeyFor } from "@/lib/route-titles";

/**
 * The document title for whatever route is showing (WCAG 2.4.2).
 *
 * Mounted once, in the root layout, and never by a page: it is the only
 * `<title>` the application renders, which is what makes the result
 * predictable (`src/lib/route-titles.ts` has the case). It survives client
 * navigation and only its text changes, so `document.title` changes with the
 * route and Next's route announcer has something to say.
 *
 * A Client Component, because the pathname is what it keys on and the server
 * layout above it does not re-render on a client navigation. It still renders
 * on the server, so a page loaded without JavaScript (`/start`) has its title
 * in the first byte.
 */
export function RouteTitle() {
  const pathname = usePathname();
  const t = useTranslations();
  const key = titleKeyFor(pathname ?? "/");

  return <title>{key ? documentTitle(t(key)) : t("metadata.title")}</title>;
}
