import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Something folded away until asked for: a native `<details>`/`<summary>`.
 *
 * Native for the reason `Select` is native — the platform already gives it
 * keyboard behaviour, an expanded state a screen reader announces, and
 * find-in-page that opens it — and nothing here has to manage focus.
 *
 * Three screens wrote it out by hand (the folded half of /inventory/add and
 * /inventory/consume, and the "why" under a product's rating), each with its
 * own copy of the 48px floor in `target-floor.test.ts`'s allow-list, and the
 * two forms set the summary to `flex`, which drops the browser's disclosure
 * triangle: nothing said the row opened. The chevron is drawn here, turns
 * when open, and is `aria-hidden` — the expanded state is announced already.
 *
 * - `panel` — a muted box whose summary is a full-width row: the folded half
 *   of a form.
 * - `inline` — a summary that reads as a link-styled line of text: "por qué".
 *
 * The ref is the `<details>`, so a form can open it when an error points
 * inside (`advancedRef.current?.setAttribute("open", "")`).
 */
const detailsVariants = cva("group", {
  variants: {
    variant: {
      panel: "rounded border border-border bg-muted",
      inline: "",
    },
  },
  defaultVariants: { variant: "panel" },
});

const summaryVariants = cva(
  // `list-none` and the webkit marker rule remove the native triangle, which
  // `flex` was already hiding in some engines and not others.
  "flex min-h-[48px] cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden",
  {
    variants: {
      variant: {
        panel: "justify-between px-4 font-medium text-foreground",
        inline:
          "inline-flex min-w-[48px] text-primary underline underline-offset-4",
      },
    },
    defaultVariants: { variant: "panel" },
  },
);

export interface DisclosureProps {
  summary: React.ReactNode;
  children: React.ReactNode;
  variant?: "panel" | "inline";
  className?: string;
}

const Disclosure = React.forwardRef<HTMLDetailsElement, DisclosureProps>(
  ({ summary, children, variant, className }, ref) => (
    <details className={cn(detailsVariants({ variant }), className)} ref={ref}>
      <summary className={cn(summaryVariants({ variant }))}>
        {summary}
        <ChevronDown
          aria-hidden="true"
          className="size-5 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      {children}
    </details>
  ),
);
Disclosure.displayName = "Disclosure";

export { Disclosure };
