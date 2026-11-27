"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import type { JSX } from "react";

/** One view of a section: where it lives and what it is called. */
export interface View {
  href: string;
  label: string;
}

/**
 * The two views of one section, side by side under its title: Inventario's
 * *Existencias | Productos*, Compra's *Listas | Precios* (`DECISIONS.md`
 * NAVIGATION).
 *
 * Links, not tabs. Each view is a screen of its own, with its own address,
 * its own back links pointing at it and its own entry in the offline cache;
 * `role="tablist"` promises panels that switch in place and arrow keys that
 * move between them, and neither is true of two routes. So it is a small
 * navigation landmark, named for the section, and the view on screen is the
 * one with `aria-current="page"`.
 *
 * The current view is marked three ways, none of them colour alone (WCAG
 * 1.4.1): the bar under it, its weight, and its ink. Each half is a 48px
 * target and they share the row equally, as the mock-up draws them.
 */
export function ViewSwitch({
  label,
  views,
  className,
}: {
  /** The landmark's name: which section these are the views of. */
  label: string;
  views: readonly View[];
  className?: string;
}): JSX.Element {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className={cn("border-b border-border", className)}>
      <ul className="flex">
        {views.map((view) => {
          const current = pathname === view.href;

          return (
            <li className="flex-1" key={view.href}>
              <Link
                aria-current={current ? "page" : undefined}
                className={cn(
                  "-mb-px flex min-h-[48px] items-center justify-center border-b-4 px-3 py-2 text-center text-base",
                  current
                    ? "border-primary font-bold text-primary"
                    : "border-transparent font-normal text-muted-foreground hover:text-foreground",
                )}
                href={view.href}
              >
                {view.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
