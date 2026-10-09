"use client";

import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { ThemeControl } from "@/components/ui/ThemeControl";
import type { JSX } from "react";

/**
 * Theme and language, together — the two preferences that work with or without
 * an account.
 *
 * The two settings that change how the app looks were previously in two
 * unrelated places — one in the navigation bar, one nowhere at all — so this
 * pairs them as a single cluster (DESIGN_AUDIT A2.4) and gives every surface
 * that needs them one thing to render.
 *
 * **How long a confirmation stays used to be the third.** It left when it
 * became an account setting: WCAG 2.2.1 is about the person, not the browser,
 * so it is stored against the account — and `/login` and `/register`, which
 * render this cluster, have no account to store it against. `/settings`
 * renders that control beside this one, where a session is guaranteed.
 *
 * The two that remain are the two that can honestly be offered signed out.
 * The theme is a property of the screen and never leaves the device. The
 * language writes to the account when there is one and to the device either
 * way (`src/lib/i18n/cookies.ts`), which is what lets the same control serve
 * the login page — the screen where somebody who cannot read the interface
 * most needs it.
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
    // `items-start`: the two controls have labels of different heights, and
    // aligning their bottoms dropped "Idioma" about 10px below "Tema".
    <div className={`flex flex-wrap items-start gap-x-6 gap-y-3 ${className}`}>
      <ThemeControl />
      <LocaleSwitcher />
    </div>
  );
}
