import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

import type { JSX, ReactNode } from "react";

/**
 * A short word about a state, on a tinted pill.
 *
 * Seven of these were written separately before this file existed — three on
 * the price screens, one per list, one per dashboard section — in four
 * different sizes and two different roundings. They are the same object.
 *
 * `tone` is the state, never the rank: `ok`/`warn`/`danger` mean healthy,
 * needs-attention and wrong, and they are reserved for exactly that. A pill
 * that means "auto-generated" or "best price" is not a state and takes
 * `neutral`.
 *
 * `variant="outline"` is for the case the inventory card found: a badge whose
 * own row is already tinted with its tone. A filled warn pill on a `bg-warn`
 * row is invisible, so the fill drops out and the border carries it. Both
 * variants keep the tone's audited foreground, so neither invents a pair
 * `check-contrast.ts` has not measured.
 *
 * Colour is never the message. Every badge in this system carries the word
 * too — that is REDESIGN_PLAN §8, and it is why `tone` has no default.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded px-2 py-1 text-sm font-medium",
  {
    variants: {
      tone: {
        ok: "",
        warn: "",
        danger: "",
        neutral: "",
      },
      variant: {
        solid: "",
        outline: "border bg-card",
      },
    },
    compoundVariants: [
      { tone: "ok", variant: "solid", class: "bg-ok text-ok-foreground" },
      { tone: "warn", variant: "solid", class: "bg-warn text-warn-foreground" },
      {
        tone: "danger",
        variant: "solid",
        class: "bg-danger text-danger-foreground",
      },
      {
        tone: "neutral",
        variant: "solid",
        class: "bg-muted text-muted-foreground",
      },
      {
        tone: "ok",
        variant: "outline",
        class: "border-ok-foreground text-ok-foreground",
      },
      {
        tone: "warn",
        variant: "outline",
        class: "border-warn-foreground text-warn-foreground",
      },
      {
        tone: "danger",
        variant: "outline",
        class: "border-danger-foreground text-danger-foreground",
      },
      {
        tone: "neutral",
        variant: "outline",
        class: "border-input text-muted-foreground",
      },
    ],
    defaultVariants: { variant: "solid" },
  },
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  tone: NonNullable<VariantProps<typeof badgeVariants>["tone"]>;
  children: ReactNode;
  className?: string;
}

export function Badge({
  tone,
  variant,
  children,
  className,
}: BadgeProps): JSX.Element {
  return (
    <span className={cn(badgeVariants({ tone, variant }), className)}>
      {children}
    </span>
  );
}

export { badgeVariants };
