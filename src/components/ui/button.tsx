import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Focus is drawn with a real outline rather than a box-shadow ring: an outline
// is never clipped by an ancestor's overflow and survives forced-colors mode.
// `outline-none` is deliberately absent — the previous version removed the
// browser's outline and replaced it with a ring built from tokens that did not
// exist, leaving keyboard users with no indicator at all (ISSUES UI-3.5).
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const buttonVariants = cva(
  `inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors ${FOCUS_RING} disabled:pointer-events-none disabled:opacity-50`,
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        // Underlined at rest. `primary` against body ink is 1.78:1 light and
        // 1.36:1 dark, under the 3:1 a colour-only cue needs (1.4.1), and a
        // touch screen has no hover to reveal it. Same rule as `ItemRow`'s
        // title and `BackLink`: a link wears its underline.
        link: "text-primary underline underline-offset-4 hover:decoration-2",
      },
      // Every size clears 48×48. WCAG 2.5.5 (AAA) asks for 44, and the phone is
      // the tier where a thumb is expected, so the floor is written unprefixed —
      // mobile-first — rather than added back at a breakpoint (DESIGN_AUDIT
      // A4.2, A3.4). `min-h` rather than `h`, so a button that wraps grows
      // instead of clipping.
      //
      // `sm` is no shorter than `default` as a result; it keeps the tighter
      // horizontal padding, which is the part of "small" that can survive a
      // 48px floor. `icon` is square at 48 because it has no label to widen it.
      size: {
        default: "min-h-[48px] px-4 py-2",
        sm: "min-h-[48px] rounded-md px-3",
        lg: "min-h-[56px] rounded-md px-8",
        icon: "min-h-[48px] min-w-[48px]",
      },
    },
    compoundVariants: [
      /**
       * A link's text starts where the text around it starts.
       *
       * Every size carries horizontal padding, which is right for a button —
       * it is a target with a surface. A `link` has no surface, so the
       * padding only pushed the words 16px to the right of the column they
       * belong to: "Volver al inventario" under a paragraph it no longer
       * lined up with, on a dozen screens.
       *
       * The 48px floor is untouched. It is `min-h`, and the click target of
       * a text link is its text — widening it with invisible padding is the
       * "Equivalent" exception being used to paper over a misalignment.
       */
      { variant: "link", class: "px-0" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
