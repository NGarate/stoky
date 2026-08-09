"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { PreferencesCluster } from "@/components/ui/PreferencesCluster";
import { DESKTOP_DESTINATIONS, activeHref } from "./navigation";
import type { JSX } from "react";

/**
 * The desktop top bar.
 *
 * Unchanged in shape, and deliberately so: `lg` and up is the densest tier —
 * mouse, keyboard, half a metre away — and a row of seven text links is the
 * right control for it (DESIGN_AUDIT A3.5). What changed is that it now stops
 * at `lg` instead of `md`, and that it no longer disappears with nothing behind
 * it: below `lg`, `CompactNav` takes over with a bottom bar or a rail
 * (ISSUES.md NAV-1).
 *
 * `hidden lg:block` is safe here in a way `hidden md:flex` was not. It is not
 * dropping content on small screens — the content is rendered by another
 * component at those widths — which is the distinction A3.4 turns on.
 */
export function DashboardNav(): JSX.Element {
  const t = useTranslations("navigation");
  const pathname = usePathname();
  const current = activeHref(pathname, DESKTOP_DESTINATIONS);

  return (
    <nav
      aria-label={t("mainLabel")}
      className="hidden border-b border-border bg-card lg:block"
    >
      {/* `flex-wrap` because the preferences cluster is wider than the locale
          select it replaces; without it the row overflows horizontally, which
          DESIGN_AUDIT A3.3 counts as a defect rather than a nit. */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="text-xl font-bold text-primary">
            Stoky
          </Link>
          <ul className="flex items-center gap-1">
            {DESKTOP_DESTINATIONS.map((destination) => {
              const isCurrent = current === destination.href;

              return (
                <li key={destination.href}>
                  <Link
                    aria-current={isCurrent ? "page" : undefined}
                    href={destination.href}
                    className={`inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm transition-colors ${
                      isCurrent
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {t(destination.labelKey)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        <PreferencesCluster />
      </div>
    </nav>
  );
}
