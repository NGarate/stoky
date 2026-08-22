import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

import type { JSX, ReactNode } from "react";

/**
 * One thing in a list, everywhere in the application.
 *
 * Nine screens drew this shape nine ways: cards on inventory and products,
 * bordered boxes on the shopping detail, `divide-y` rows on prices and the
 * dashboard, a whole-card `<Link>` on receipts, a full-width button on the
 * shop screen. Same object, same job, six visual grammars. The owner picked
 * the inventory card, so this is the inventory card — lifted, not redesigned.
 *
 * `density` is the one thing that varies, and it varies for a reason
 * REDESIGN_PLAN keeps: Screen A is used with a trolley in one hand and Screen
 * B is read from a metre away, so their rows are deliberately bigger than the
 * desktop's. Three sizes, one grammar — rather than one size that is wrong on
 * two of the three tiers.
 *
 * `tone` tints the row for a state that is about the row itself (a product
 * below its minimum). It is not decoration and it is never the only carrier:
 * the `status` slot says the same thing in words.
 *
 * `href` links the *title*, not the row. A card-sized link announces its whole
 * contents as its name, which is how "Café molido, categoría café, 0 paquete,
 * sin stock" becomes a link label; and a row that is entirely a link has
 * nowhere to put an action.
 */
const itemRowVariants = cva(
  "rounded-lg border border-border shadow-sm transition-colors",
  {
    variants: {
      density: {
        compact: "p-3",
        default: "p-4 md:p-5",
        touch: "min-h-[64px] p-4 md:p-5",
      },
      tone: {
        neutral: "bg-card",
        warn: "bg-warn",
        danger: "bg-danger",
      },
    },
    defaultVariants: { density: "default", tone: "neutral" },
  },
);

const titleVariants = cva(
  // `min-w` as well as `min-h`. A target is 48px in *both* directions, and a
  // short product name is not: "Lidl" measured 25×48 on the receipts list and
  // `e2e/a11y-structure.spec.ts` failed it at all three tiers. The underline
  // decorates the text run rather than the flex box, so the box grows and the
  // rule under the word does not.
  "inline-flex min-h-[48px] min-w-[48px] items-center font-medium text-foreground",
  {
    variants: {
      density: {
        compact: "text-base",
        default: "md:text-xl",
        touch: "text-xl md:text-2xl",
      },
    },
    defaultVariants: { density: "default" },
  },
);

const metaVariants = cva("mt-3 grid grid-cols-2 gap-x-4 gap-y-2", {
  variants: {
    density: {
      compact: "text-sm",
      default: "text-sm md:text-lg",
      touch: "text-base md:text-xl",
    },
  },
  defaultVariants: { density: "default" },
});

export interface MetaEntry {
  label: string;
  value: ReactNode;
}

export interface ItemRowProps extends VariantProps<typeof itemRowVariants> {
  title: ReactNode;
  /** When present, the title becomes a link to here. */
  href?: string;
  /** A `<Badge>`, sat opposite the title. */
  status?: ReactNode;
  /** Rendered as a two-column definition list under the title. */
  meta?: MetaEntry[];
  /** `<Button>`s. A link belongs here only when it genuinely navigates. */
  actions?: ReactNode;
  /** `li` inside a `<ul>`, which is what every list here is. */
  as?: "li" | "div";
  className?: string;
}

export function ItemRow({
  title,
  href,
  status,
  meta,
  actions,
  density,
  tone,
  as: Element = "li",
  className,
}: ItemRowProps): JSX.Element {
  return (
    <Element className={cn(itemRowVariants({ density, tone }), className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        {href ? (
          <Link
            className={cn(
              titleVariants({ density }),
              "text-primary underline underline-offset-4",
            )}
            href={href}
          >
            {title}
          </Link>
        ) : (
          <span className={titleVariants({ density })}>{title}</span>
        )}
        {status}
      </div>

      {meta && meta.length > 0 ? (
        <dl className={metaVariants({ density })}>
          {meta.map((entry) => (
            <div key={entry.label}>
              <dt className="text-muted-foreground">{entry.label}</dt>
              <dd className="mt-1 text-foreground">{entry.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {actions ? (
        <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
      ) : null}
    </Element>
  );
}

export { itemRowVariants };
