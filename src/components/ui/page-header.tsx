import { cva } from "class-variance-authority";

import { BackLink } from "@/components/ui/back-link";
import { cn } from "@/lib/utils";

import type { JSX, ReactNode } from "react";

/**
 * How wide a screen is, chosen by what kind of screen it is.
 *
 * The layout pads every route and bounds it at `max-w-7xl`; each screen then
 * narrows within that. They used to say so one at a time, and the same kind
 * of screen came out at four different widths — a form at 2xl here and 6xl
 * there, a detail at 3xl and 4xl. So the width is a property of the *kind*:
 *
 * | Kind | Width | Why |
 * |---|---|---|
 * | `form` | 2xl | one column of fields, read top to bottom on a phone |
 * | `detail` | 3xl | one thing, its sections stacked |
 * | `screen` | 5xl | a whole-screen overview (the Panel, the kitchen) |
 * | `index` | 6xl | a list of things, a table from `lg` |
 *
 * There is no gutter here: the layout's `p-4` is the only one. A second `p-6`
 * on a screen cost 48px of a 390px phone (ISSUES UI-5) and made that screen
 * more inset than its neighbours.
 */
const PAGE_WIDTHS = {
  form: "max-w-2xl",
  detail: "max-w-3xl",
  screen: "max-w-5xl",
  index: "max-w-6xl",
} as const;

export type PageWidth = keyof typeof PAGE_WIDTHS;

export function PageShell({
  width,
  children,
  className,
}: {
  width: PageWidth;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn("mx-auto", PAGE_WIDTHS[width], className)}>
      {children}
    </div>
  );
}

/**
 * The one size a page title comes in.
 *
 * There were two — `text-2xl` everywhere on a phone, then `md:text-4xl` on
 * some screens and not on others, so moving between two settings pages
 * changed the title's size for no reason anyone had written down. `touch` is
 * the kitchen's, which is read from a metre away and is `text-4xl` at every
 * width (`REDESIGN_PLAN.md` §4: 40px+ headings).
 */
const titleVariants = cva("font-bold text-heading", {
  variants: {
    density: {
      default: "text-2xl md:text-4xl",
      touch: "text-4xl",
    },
  },
  defaultVariants: { density: "default" },
});

export interface PageBack {
  href: string;
  /** Names the destination: "Volver a tus listas", not "Volver". */
  label: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  /** The way back out of a sub-page. Above the title, always. */
  back?: PageBack;
  /** One sentence saying what this screen is for. */
  intro?: ReactNode;
  /**
   * `<Button>`s. At most one `default` — the screen's primary action — and
   * the rest `outline` (`REDESIGN_PLAN.md` §7: one primary action per
   * screen).
   */
  actions?: ReactNode;
  density?: "default" | "touch";
  className?: string;
}

/**
 * The top of every screen, in one arrangement.
 *
 * There were five: the way back above the title, below it, or beside it;
 * the primary action beside the title, or between the title and the sentence
 * that explains it. A person moving between two screens had to find the
 * title, the way out and the button again each time. The grammar is now
 * fixed:
 *
 * 1. **The way back**, above the title, naming where it goes.
 * 2. **The title** — the page's only `h1`.
 * 3. **The intro**, directly under the title it explains.
 * 4. **The actions** — on a phone a full-width row of their own under the
 *    words, from `md` opposite the title. Two buttons squeezed beside a title
 *    on a 390px screen pushed `/shopping/lists` to 399px wide, which is a
 *    WCAG 1.4.10 reflow failure rather than a cosmetic one.
 *
 * DOM order is reading order: title and intro come before the actions, so a
 * screen reader hears what the screen is before what it can do.
 */
export function PageHeader({
  title,
  back,
  intro,
  actions,
  density,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <div className={cn("mb-6", className)}>
      {back ? <BackLink href={back.href}>{back.label}</BackLink> : null}
      <div
        className={cn(
          "flex flex-col gap-4 md:flex-row md:items-start md:justify-between",
          back ? "mt-2" : null,
        )}
      >
        <div className="min-w-0">
          <h1 className={titleVariants({ density })}>{title}</h1>
          {intro ? (
            <p className="mt-2 text-muted-foreground">{intro}</p>
          ) : null}
        </div>
        {actions ? (
          // Each button takes an equal share of the phone's row and wraps to
          // a row of its own when the two cannot share one; from `md` they
          // keep their own width and sit opposite the title.
          <div
            className="flex flex-wrap gap-2 md:shrink-0 md:justify-end [&>*]:flex-1 md:[&>*]:flex-none"
            data-slot="page-actions"
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { PAGE_WIDTHS, titleVariants as pageTitleVariants };
