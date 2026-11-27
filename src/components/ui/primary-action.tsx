import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { JSX, ReactNode } from "react";

/**
 * A screen's one primary action, always in the same spot (`DECISIONS.md`
 * NAVIGATION, USABILITY rule 1).
 *
 * Below `lg` it is fixed above the thumb: bottom right, just over the phone's
 * bar, and in the same corner of the tablet, as the mock-ups draw it — an
 * extended button, the icon and the words, 56px tall. From `lg`, with a mouse
 * and no bar at the bottom, it is an ordinary button opposite the title,
 * where `PageHeader` puts it; the corner of a desktop screen is the last
 * place anybody looks.
 *
 * It is one element, not one per tier, so there is never a second copy for a
 * test or a screen reader to find. `PageHeader` renders it first among the
 * actions, so it is read straight after the title.
 *
 * A link: every primary action that has earned this place goes somewhere — a
 * form or a picker of its own. One that opens a form in place stays a header
 * button, because a form appearing at the top of a page from a button at the
 * bottom of it is one nobody sees open.
 *
 * The layout pads the foot of every screen (`(dashboard)/layout.tsx`) so the
 * last row is not left under it, and the snackbar opens above it.
 */
export function PrimaryAction({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Button
      asChild
      className="fixed right-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-30 min-h-[56px] gap-2 rounded-2xl px-5 text-base font-semibold shadow-lg md:right-6 md:bottom-6 lg:static lg:min-h-[48px] lg:rounded-md lg:px-4 lg:text-sm lg:shadow-none"
      data-primary-action=""
    >
      <Link href={href}>
        <Plus aria-hidden="true" className="size-6 lg:size-5" />
        {children}
      </Link>
    </Button>
  );
}
