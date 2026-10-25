"use client";

import { Check } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";

import type { ChangeEvent, JSX, ReactNode } from "react";

/**
 * A yes/no choice with its words, sized like a control rather than like text.
 *
 * The technique is `RadioOption`'s, for the same reason (DESIGN_AUDIT A4.2): a
 * bare `<input type="checkbox">` is about 13px across, and the target that has
 * to clear the 48px floor is the *input*, not the label around it. So the real
 * input is stretched over the whole label and made invisible, and the box a
 * person sees is drawn beside the words. The obvious `sr-only` on the input
 * looks identical and moves the target back to 13px;
 * `target-size.test.tsx` measures the input, which is what catches that.
 *
 * - **Native semantics.** It is a real checkbox, so its role, its state, Space
 *   to toggle and its place in a form's data come from the browser. Left
 *   uncontrolled, a ticked box submits `name=on` like any other.
 * - **The drawn box follows the input, not a prop.** It reads `:checked`
 *   through `peer-checked:`, so the same markup is right whether the caller
 *   controls it (`checked`) or not (`defaultChecked`).
 * - **The tick is shown by a mark, not by fill alone.** In forced-colours mode
 *   the fill is replaced by the system background, so the check mark carries
 *   the state there; it is hidden with `visibility`, which forced colours do not
 *   touch, rather than with a transparent colour, which they might.
 * - **The hint sits outside the label.** Inside it, it would be read as part of
 *   the name on every focus; outside, it is a description (`aria-describedby`),
 *   which is what it is. A `<p>` inside a `<label>` is not valid HTML either.
 *
 * No new colour: the box is `border-input` on `background` and, ticked,
 * `primary-foreground` on `primary` — pairs `scripts/check-contrast.ts`
 * already audits.
 */
export function Checkbox({
  id,
  name,
  checked,
  defaultChecked,
  onCheckedChange,
  label,
  hint,
  disabled,
  className,
}: {
  /** The input's id. Minted with `useId` when omitted. */
  id?: string;
  name?: string;
  /** Controlled state. Leave unset and use `defaultChecked` for a plain form. */
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** The accessible name: the words beside the box. */
  label: ReactNode;
  /** Secondary text, announced as the checkbox's description. */
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  const minted = useId();
  const inputId = id ?? minted;
  const hintId = `${inputId}-hint`;

  return (
    <div className={className}>
      <label
        className={cn(
          "relative flex min-h-[48px] min-w-[48px] cursor-pointer items-center gap-3 rounded py-2 text-sm text-foreground",
          "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
          "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
        )}
        htmlFor={inputId}
      >
        <input
          aria-describedby={hint === undefined ? undefined : hintId}
          checked={checked}
          className="peer absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded opacity-0 disabled:cursor-not-allowed"
          defaultChecked={defaultChecked}
          disabled={disabled}
          id={inputId}
          name={name}
          onChange={
            onCheckedChange === undefined
              ? undefined
              : (event: ChangeEvent<HTMLInputElement>) =>
                  onCheckedChange(event.target.checked)
          }
          type="checkbox"
        />
        {/* The input above stays the hit target; nothing drawn takes a click. */}
        <span
          aria-hidden="true"
          className="pointer-events-none flex size-5 shrink-0 items-center justify-center rounded border border-input bg-background text-primary-foreground peer-checked:border-primary peer-checked:bg-primary peer-checked:[&>svg]:visible"
        >
          <Check
            aria-hidden="true"
            className="invisible size-4"
            strokeWidth={3}
          />
        </span>
        <span className="pointer-events-none">{label}</span>
      </label>
      {hint === undefined ? null : (
        <p className="pl-8 text-sm text-muted-foreground" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
