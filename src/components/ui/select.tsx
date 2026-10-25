import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A native `<select>`, wearing the same clothes as `Input`.
 *
 * Native rather than a listbox built from divs, and that is a decision worth
 * stating: a native select gets the platform's own picker on a phone — the
 * wheel at the bottom of the screen rather than a dropdown drawn over a page
 * you have to scroll — plus type-ahead, keyboard behaviour and forced-colors
 * support that a rebuild has to earn back one property at a time.
 *
 * `LocationPicker` is the one exception in this application, and it is an
 * exception for a reason it documents: a hierarchy of nested locations is not
 * a flat list, and it needs to place its own panel against the phone's fixed
 * bottom bar.
 *
 * Five screens had this written out, each with its own copy of the 48px floor.
 */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        className={cn(
          // Same geometry, same fill and the same focus treatment as
          // `Input`, because it sits beside one in every form that has both.
          // The fill was `bg-card` while `Input` was `bg-background`, so the
          // two boxes on the shopping row — a quantity and a shop — were
          // visibly different shades of the same control.
          "flex min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-foreground text-sm",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = "Select";

export { Select };
