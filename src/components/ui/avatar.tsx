import { cn } from "@/lib/utils";

import type { JSX } from "react";

/**
 * The first letter of a person's first two words, for a circle that stands
 * for them. By code point rather than by UTF-16 unit, so a name that starts
 * outside the basic plane is not cut in half; the address stands in for a
 * name that is only spaces.
 */
export function initialsOf(name: string, fallback = ""): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const source = words.length > 0 ? words.slice(0, 2) : [fallback.trim()];
  return source
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
}

/**
 * A person, as a circle with their initials.
 *
 * Decoration, so `aria-hidden`: wherever it appears the name is said in words
 * beside it or in the control's accessible name, and "N G" read out letter by
 * letter would only be noise. There is no photograph because the application
 * stores none — an upload would need the receipt images' treatment (magic
 * bytes, re-encoding, serving only to the signed-in) and nobody has asked for
 * that yet. `primary` on `primary-foreground` is a pair `check-contrast.ts`
 * already audits.
 */
export function Avatar({
  name,
  email = "",
  className,
}: {
  name: string;
  email?: string;
  className?: string;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-10 shrink-0 select-none items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground",
        className,
      )}
    >
      {initialsOf(name, email)}
    </span>
  );
}
