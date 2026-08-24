"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
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
 *
 * It no longer carries the preferences. Theme, language and how long a
 * confirmation stays were rendered in this bar on every signed-in route, which
 * put three settings controls across the top of the household overview — the
 * screen whose whole job is what to buy and what is running out. They live on
 * `/settings`, which this bar links to, and which is where somebody goes when
 * changing a setting is what they came to do.
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
      {/* `flex-wrap` kept even though the row is now only the wordmark and the
          destinations: eight labels in a long language still wrap before they
          overflow, and a horizontal scrollbar on the shell is DESIGN_AUDIT
          A3.3 rather than a nit. */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-8">
          {/* The wordmark is a link like any other and gets the same target
              floor; at 54×28 it was the smallest control on every signed-in
              route (DESIGN_AUDIT A4.2).
              `min-w` explicitly, because the `link` variant carries no
              horizontal padding — a link in a column of text should start
              where that text starts. This one is not in a column of text: it
              is a navigation target sitting alone, so it states its own
              width rather than borrowing a button's. Measured at 35×48
              without it, which the structural audit failed at desktop. */}
          <Button asChild className="min-w-[48px]" variant="link">
            <Link href="/dashboard" > Stoky </Link>
          </Button>
          <ul className="flex items-center gap-1">
            {DESKTOP_DESTINATIONS.map((destination) => {
              const isCurrent = current === destination.href;

              return (
                <li key={destination.href}>
                  <Link
                    aria-current={isCurrent ? "page" : undefined}
                    href={destination.href}
                    className={`inline-flex min-h-[48px] items-center rounded-md px-3 py-2 text-sm transition-colors ${
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
      </div>
    </nav>
  );
}
