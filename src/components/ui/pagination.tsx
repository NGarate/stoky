"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { JSX } from "react";

/**
 * Which page you are on, and the two you can reach from it.
 *
 * Numbered links to every page were considered and rejected: a household with
 * forty pages would render forty targets, and the question people actually
 * have here is "is there more" rather than "take me to page seven". The
 * position is stated in words instead.
 *
 * Links rather than buttons, because each one goes somewhere and that
 * somewhere has an address: a filtered, sorted page of the inventory is a
 * thing worth sending to someone. `check-links.ts` strips the query string, so
 * these resolve to `/inventory` and pass.
 *
 * The status line is inside the `<nav>` and is what a screen reader hears
 * between the two links, so "anterior, página 2 de 7, siguiente" reads as one
 * control rather than as two unrelated words.
 */
export function Pagination({
  page,
  pageCount,
  hrefFor,
  label,
  status,
  previousLabel,
  nextLabel,
  className,
}: {
  page: number;
  pageCount: number;
  /** The address of a page, so the caller keeps its own query shape. */
  hrefFor: (page: number) => string;
  /** Names the nav. Never "navegación": say what it paginates. */
  label: string;
  /** Already interpolated, e.g. "Página 2 de 7". */
  status: string;
  previousLabel: string;
  nextLabel: string;
  className?: string;
}): JSX.Element | null {
  // One page is not a pager. Rendering it disabled would add two dead
  // controls to every short list in the application.
  if (pageCount <= 1) return null;

  const step = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <nav
      aria-label={label}
      className={cn(
        "mt-6 flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      {page > 1 ? (
        <Link className={step} href={hrefFor(page - 1)}>
          {previousLabel}
        </Link>
      ) : (
        // A span, not a disabled link: a disabled link is not a thing, and
        // the gap keeps the next control from sliding under the thumb.
        <span aria-hidden="true" className="min-h-[48px]" />
      )}

      <p className="text-muted-foreground">{status}</p>

      {page < pageCount ? (
        <Link className={step} href={hrefFor(page + 1)}>
          {nextLabel}
        </Link>
      ) : (
        <span aria-hidden="true" className="min-h-[48px]" />
      )}
    </nav>
  );
}
