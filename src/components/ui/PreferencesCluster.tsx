"use client";

import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { SnackbarDurationControl } from "@/components/ui/SnackbarDurationControl";
import { ThemeControl } from "@/components/ui/ThemeControl";
import type { JSX } from "react";

/**
 * Theme, language and how long a confirmation stays, together.
 *
 * The two settings that change how the app looks were previously in two
 * unrelated places — one in the navigation bar, one nowhere at all — so this
 * pairs them as a single cluster (DESIGN_AUDIT A2.4) and gives every surface
 * that needs them one thing to render.
 *
 * It carries no group label of its own. Both controls are individually
 * labelled, and the surfaces that want a heading (`/settings`) already have
 * one; adding a second name here would just make screen-reader output longer
 * without making it clearer.
 *
 * It wraps rather than overflows: `/login` at 390px has room for one control
 * per line and not two.
 */
export function PreferencesCluster({
  className = "",
}: {
  className?: string;
}): JSX.Element {
  return (
    <div className={`flex flex-wrap items-end gap-x-6 gap-y-3 ${className}`}>
      <ThemeControl />
      <LocaleSwitcher />
      {/* WCAG 2.2.1: the snackbar removes itself, which is a time limit, and
          a time limit has to be adjustable. It sits here rather than in a
          settings page of its own because it is the same kind of thing as
          the two beside it — how this screen behaves for the person at it. */}
      <SnackbarDurationControl />
    </div>
  );
}
