import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

import type { JSX, ReactNode } from "react";

/**
 * What a list says when there is nothing in it.
 *
 * Five looks for one moment: a centred card with two grey lines, a muted box
 * with an icon, a bordered paragraph, a green panel, and a bare sentence. And
 * most of them stopped at the mood — "No hay listas de compra" — without the
 * one thing an empty screen owes the person looking at it, which is what to
 * do next (`REDESIGN_PLAN.md` §7 rule 5: empty is an invitation with a
 * button).
 *
 * So the grammar is fixed: a **title** that says what is missing, in plain
 * words; a **body** of one sentence that says how things get here; and the
 * **action** that does it. Left-aligned, like the list it stands in for, so
 * the eye lands where the first row would have been.
 *
 * The title is not a heading. An empty state sits inside screens and sections
 * at every depth, and a heading here would have to know its own level to
 * keep the outline in order (DESIGN_AUDIT A4.3) — the section around it is
 * the heading that matters.
 *
 * `touch` is the kitchen's: read from a metre away, so the type is larger.
 */
const titleVariants = cva("font-semibold text-heading", {
  variants: {
    density: {
      default: "text-lg",
      touch: "text-2xl",
    },
  },
  defaultVariants: { density: "default" },
});

const bodyVariants = cva("mt-2 text-muted-foreground", {
  variants: {
    density: {
      default: "",
      touch: "text-xl",
    },
  },
  defaultVariants: { density: "default" },
});

export interface EmptyStateProps {
  /** What is missing: "Todavía no tienes listas". */
  title: ReactNode;
  /** One sentence: how things come to be here. */
  body?: ReactNode;
  /**
   * The next step — a `<Button>`, or two when there are genuinely two ways
   * in. `outline` when the screen's header already offers the same action as
   * its one `default`.
   */
  action?: ReactNode;
  density?: "default" | "touch";
  className?: string;
}

export function EmptyState({
  title,
  body,
  action,
  density,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn("rounded-lg border border-border bg-card p-6", className)}
      data-slot="empty-state"
    >
      <p className={titleVariants({ density })}>{title}</p>
      {body ? <p className={bodyVariants({ density })}>{body}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
