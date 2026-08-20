"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef } from "react";
import { PreferencesCluster } from "@/components/ui/PreferencesCluster";
import { tabbableWithin } from "@/lib/focus";

import { SECONDARY_DESTINATIONS } from "./navigation";
import type { JSX } from "react";

interface NavSheetProps {
  /** The destination the current route belongs to, or `null`. */
  currentHref: string | null;
  /** Called for Escape, the close button and a tap on the scrim. */
  onClose: () => void;
  open: boolean;
}

/**
 * The "Más" panel: the destinations the compact tiers do not show, plus theme
 * and language.
 *
 * Hand-rolled rather than `<dialog>`. `showModal()` would give the focus trap
 * and Escape for free, but it is not implemented in the DOM the component tests
 * run against, and a control every route depends on should be testable. The
 * behaviour it replaces is written out below and asserted in
 * `src/__tests__/components/CompactNav.test.tsx`.
 *
 * It renders nothing at all when closed, which keeps its links out of the
 * accessibility tree and out of the tab order without relying on `inert`.
 *
 * Placement follows the tier: a bottom sheet on the phone, where the thumb is,
 * and a full-height panel down the left on the tablet, next to the rail that
 * opened it. Both are the same DOM.
 */
export function NavSheet({
  currentHref,
  onClose,
  open,
}: NavSheetProps): JSX.Element | null {
  const t = useTranslations("navigation");
  const tCommon = useTranslations("common");
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      // Tab stops, not focusable elements. A radio group is one stop, and a
      // `last` the browser never reaches is a wrap that never fires — see
      // `tabbableWithin`.
      const stops = tabbableWithin(panel);
      if (stops.length === 0) return;

      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;

      // Wrapping is done by hand because focus must not escape into the page
      // behind the sheet — the destinations there are the ones this panel is
      // covering, and tabbing into them would be tabbing into nothing visible.
      //
      // `active === panel` is the state the sheet opens in: focus is on the
      // panel itself, which is before every control in it, so shift+Tab from
      // there is a backwards exit and has to wrap the same way.
      const atStart = active === first || active === panel;

      if (event.shiftKey && (atStart || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    // Restored on close: whoever opened the sheet gets focus back, or the
    // keyboard user is dumped at the top of the document.
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    panelRef.current?.focus();
    document.addEventListener("keydown", handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [handleKeyDown, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Decorative scrim. The panel carries a real close button, so this is a
          convenience rather than the only way out, and it stays out of the tab
          order and out of the accessibility tree. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-foreground/60"
        onClick={onClose}
      />

      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 md:inset-y-0 md:right-auto md:w-96 md:max-h-none md:rounded-none md:border-r md:border-t-0 md:p-6"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            className="text-lg font-semibold text-heading md:text-2xl"
            id={titleId}
          >
            {t("moreTitle")}
          </h2>
          <button
            className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-md border border-input bg-card px-3 font-medium text-foreground hover:bg-accent hover:text-accent-foreground md:text-lg"
            onClick={onClose}
            type="button"
          >
            {tCommon("close")}
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {SECONDARY_DESTINATIONS.map((destination) => {
            const isCurrent = currentHref === destination.href;

            return (
              <li key={destination.href}>
                <Link
                  aria-current={isCurrent ? "page" : undefined}
                  className={`flex min-h-[56px] items-center rounded-md px-4 md:min-h-[64px] md:text-xl ${
                    isCurrent
                      ? "border-l-4 border-primary bg-primary font-semibold text-primary-foreground"
                      : "border-l-4 border-transparent font-normal text-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                  href={destination.href}
                  onClick={onClose}
                >
                  {t(destination.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-semibold text-heading md:text-lg">
            {t("preferencesTitle")}
          </h3>
          <PreferencesCluster />
        </div>
      </div>
    </div>
  );
}
