import { cva } from "class-variance-authority";
import { useId } from "react";

import type { JSX, ReactNode } from "react";

/**
 * The one size a section heading comes in.
 *
 * Section titles had drifted into four treatments: `text-lg` here, `md:text-2xl`
 * there, an unsized `font-semibold` on the scan screen, and tracked uppercase
 * grey labels on the two main screens — the last of which is the commonest
 * tell of a template rather than a decision, and reads as a label nobody taps
 * rather than as the start of a section. One token, sentence case, and the
 * kitchen's larger size only at its distance (`REDESIGN_PLAN.md` §4).
 *
 * Exported for the one heading that cannot be a `Section`: the shop screen's
 * trolley, whose heading *is* the disclosure button that opens it.
 */
export const sectionHeading = cva("font-semibold text-heading", {
  variants: {
    density: {
      default: "text-lg",
      touch: "text-lg md:text-2xl",
    },
  },
  defaultVariants: { density: "default" },
});

export interface SectionProps {
  title: ReactNode;
  /**
   * What sits opposite the heading: a link to the whole set, a count. Not the
   * screen's primary action — that is `PageHeader`'s.
   */
  aside?: ReactNode;
  density?: "default" | "touch";
  children: ReactNode;
  className?: string;
  /** For a caller that must point at the heading from elsewhere. */
  id?: string;
}

/**
 * A titled part of a screen: a `<section>` named by its own `<h2>`.
 *
 * Every screen wrote this by hand, with its own spacing and its own idea of
 * how big an h2 is — and one, `StoreComparison`, drew an h3 larger than the h2
 * above it, so the outline said "part of" while the type said "more important
 * than" (WCAG 1.3.1). Named by `aria-labelledby`, so the region a screen
 * reader lists is called what the reader sees.
 *
 * Always `h2`: a screen's sections sit directly under its one `h1`. Something
 * nested inside a section is not a second `Section`.
 */
export function Section({
  title,
  aside,
  density,
  children,
  className,
  id,
}: SectionProps): JSX.Element {
  const generated = useId();
  const headingId = id ?? `section-${generated}`;

  return (
    <section aria-labelledby={headingId} className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={sectionHeading({ density })} id={headingId}>
          {title}
        </h2>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
