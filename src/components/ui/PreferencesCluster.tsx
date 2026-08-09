"use client";

import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { ThemeControl } from "@/components/ui/ThemeControl";
import type { JSX } from "react";

/**
 * Theme and language, together.
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
    </div>
  );
}
