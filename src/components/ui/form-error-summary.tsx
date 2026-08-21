"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import type { JSX } from "react";

/**
 * Why a refused submit does not become a snackbar.
 *
 * Five forms wrote this same block. It is tempting to route it through the
 * one feedback surface with everything else, and it would be wrong on four
 * counts, each of them a success criterion:
 *
 * - **It is the target of a focus move** (WCAG 3.3.1). Focus lands here so the
 *   reasons are read at the point of failure, and then Tab walks straight into
 *   the fields that caused them. A snackbar sits outside the form's tab order
 *   by design, so focusing it would strand the person at the end of the page.
 * - **It lists several things at once.** A snackbar shows one sentence; a
 *   refusal can have four reasons and all of them have to be readable together.
 * - **It is still true while the form is invalid** (3.3.3). A reason that
 *   removes itself after six seconds is a reason you cannot re-read while
 *   fixing the field it describes.
 * - **It is not a time limit** (2.2.1), and making it one would create a
 *   problem the snackbar had to solve with a preference.
 *
 * So this is an extraction, not a conversion: same markup, same `role`, same
 * focus behaviour, in one place instead of five.
 *
 * **`role="alert"` here is not the thing `SyncStatus` forbids.** That rule is
 * about live regions whose role alternates, and about a second `role="alert"`
 * colliding with Next's route announcer in browser selectors. This is a static
 * alert that is focused rather than polled, and `data-testid` exists so a
 * browser test can name it without `getByRole("alert")` resolving to two
 * elements.
 *
 * **`focusSignal` stays at the call site, and must.** It is a counter bumped
 * on every refusal, not a derived value. Keying the focus effect on
 * `messages` instead would either steal focus on every keystroke — the array
 * is rebuilt by `.filter()` on each render, so its identity always changes —
 * or never re-focus an identical second refusal, which is the common case:
 * submit, read nothing, submit again. `/products/new` also raises it from a
 * path that is not a submit at all.
 */
export function FormErrorSummary({
  title,
  messages,
  focusSignal,
  className,
}: {
  /** Already translated. A key here would slip past the catalogue scanners. */
  title: string;
  /** Already translated, in the order they should be read. */
  messages: string[];
  /** Bumped by the page on every refusal, including an identical one. */
  focusSignal: number;
  className?: string;
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Not on mount: a form that opens with the box focused has refused
    // nothing yet.
    if (focusSignal > 0) ref.current?.focus();
  }, [focusSignal]);

  if (messages.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded border border-danger-foreground bg-danger p-4 text-danger-foreground",
        className,
      )}
      data-testid="form-error-summary"
      ref={ref}
      role="alert"
      tabIndex={-1}
    >
      <h2 className="font-semibold">{title}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
