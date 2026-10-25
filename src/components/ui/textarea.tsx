import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A `<textarea>`, wearing the same clothes as `Input`.
 *
 * `Input` is an `<input>` and cannot serve this: a note about a stock entry is
 * several lines, and `rows` is not a thing an input has. The two screens that
 * needed one carried `Input`'s classes written out, which is the copy this
 * removes.
 *
 * The 48px floor is a floor rather than a height — `rows` decides the resting
 * size, and a textarea that grows must not be clipped to a control's height.
 */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[48px] w-full rounded-md border border-input bg-card px-3 py-2 text-foreground text-sm",
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
Textarea.displayName = "Textarea";

export { Textarea };
