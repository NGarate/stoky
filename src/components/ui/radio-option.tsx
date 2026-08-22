"use client";

import { cn } from "@/lib/utils";

import type { JSX, ReactNode } from "react";

/**
 * One choice in a radio group, sized like a control rather than like text.
 *
 * A bare `<input type="radio">` is about 13px across. The target that has to
 * clear the 48px floor is the *input*, not the label around it, so the input
 * is stretched over the whole option and made invisible while the visible
 * shape is drawn by the label (DESIGN_AUDIT A4.2).
 *
 * Three screens had written that out by hand — the theme control, the
 * snackbar duration and the role picker on /settings/people — and the
 * technique is subtle enough that a fourth would have got it wrong: the
 * obvious `sr-only` on the input moves the target back to 13px while looking
 * identical, and nothing but a browser measurement would say so.
 *
 * The two visual treatments are the same control with different clothes:
 * `segment` for a joined bar of short choices, `card` for a stacked list where
 * each option carries a description.
 */
export function RadioOption({
  name,
  value,
  checked,
  onSelect,
  variant = "segment",
  className,
  children,
}: {
  /** Radios group by `name`; mint it with `useId` so two groups never merge. */
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  variant?: "segment" | "card";
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label
      className={cn(
        "relative min-h-[48px] cursor-pointer rounded transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
        variant === "segment"
          ? "inline-flex min-w-[48px] items-center justify-center px-3 text-sm"
          : "flex items-start gap-3 rounded-md border border-input p-3",
        // Selection is shown by weight as well as by fill, so the current
        // choice is never conveyed by colour alone.
        variant === "segment" && checked
          ? "bg-primary font-semibold text-primary-foreground"
          : variant === "segment"
            ? "font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
            : "",
        className,
      )}
    >
      <input
        checked={checked}
        className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded opacity-0"
        name={name}
        onChange={onSelect}
        type="radio"
        value={value}
      />
      {/* The input underneath must stay the hit target. */}
      <span className="pointer-events-none">{children}</span>
    </label>
  );
}
