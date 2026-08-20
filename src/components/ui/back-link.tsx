import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";

import type { JSX, ReactNode } from "react";

/**
 * The way back out of a sub-page.
 *
 * This is the one navigation affordance that stays a link rather than
 * becoming a `<Button>`: it goes somewhere, the text says where, and
 * dressing it as a button would claim it does something. What it was
 * missing is the arrow — "Volver al producto" with no direction reads as a
 * label until you notice it is blue.
 *
 * The arrow is `aria-hidden`, so the accessible name is the words alone.
 * That matters twice over: a screen reader announcing "flecha izquierda
 * volver al producto" is noise, and WCAG 2.4.9 asks that the link's purpose
 * be clear from its text without it (DESIGN_AUDIT §4). `lucide-react` already
 * defaults to `aria-hidden` on an unlabelled icon; the prop is written out
 * anyway, because the guarantee belongs to this file rather than to a
 * dependency's default that a minor upgrade may reconsider.
 *
 * Consequently the arrow must never be baked into a message string. Four
 * catalogue entries still carry a literal "← " today; they are the reason
 * this component exists rather than a convention, and the sweep that adopts
 * it strips them.
 */
export function BackLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <Link
      className={cn(
        "inline-flex min-h-[48px] items-center gap-2 text-primary underline underline-offset-4",
        className,
      )}
      href={href}
    >
      <ArrowLeft aria-hidden="true" className="h-5 w-5 shrink-0" />
      {children}
    </Link>
  );
}
