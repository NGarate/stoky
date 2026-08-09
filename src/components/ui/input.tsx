import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Focus is a real outline, not a box-shadow ring, and `outline-none`
          // is deliberately absent: the previous version removed the browser
          // outline and replaced it with a ring built from tokens that did not
          // exist (ISSUES UI-3.5).
          // 48px tall, not 40: WCAG 2.5.5 (AAA) wants 44 and the phone is the
          // tier where a thumb is expected, so the floor is unprefixed rather
          // than added back at a breakpoint (DESIGN_AUDIT A4.2, A3.4).
          "flex min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
