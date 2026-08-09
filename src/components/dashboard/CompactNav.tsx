"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Menu, Package, ScanLine, ShoppingCart } from "lucide-react";
import { NavSheet } from "./NavSheet";
import {
  COMPACT_DESTINATIONS,
  PRIMARY_DESTINATIONS,
  SECONDARY_DESTINATIONS,
  activeHref,
} from "./navigation";
import type { ComponentType, JSX, SVGProps } from "react";

/** One glyph per primary destination, keyed by its label. */
const ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  shoppingShort: ShoppingCart,
  inventory: Package,
  scan: ScanLine,
};

/**
 * The phone and tablet navigation.
 *
 * Two surfaces, one information architecture, one sheet:
 *
 * - **Phone** (base → `md`): a bottom bar. Not a hamburger — the phone screen is
 *   used one-handed and standing, and the top corner is the furthest point on a
 *   modern phone from a thumb (DESIGN_AUDIT A3.6, PROGRESS D15). The
 *   destinations stay visible instead of hiding behind a control someone has to
 *   know to press.
 * - **Tablet** (`md` → `lg`): a side rail. A bottom bar would spend the most
 *   valuable strip of a screen read from a metre away, and the kitchen tablet is
 *   propped up rather than held. Bigger type and bigger targets than the phone,
 *   because it is the least dense tier, not an interpolation towards desktop
 *   (D14).
 *
 * Both carry the same four items and open the same "Más" sheet, so there is one
 * thing to learn and one thing to keep working.
 *
 * Only one of the two is ever rendered visibly, which is why they can share the
 * accessible name: a hidden `<nav>` is not in the accessibility tree, so the
 * landmark stays unique at every width.
 */
export function CompactNav(): JSX.Element {
  const t = useTranslations("navigation");
  const pathname = usePathname();
  const [isSheetOpen, setSheetOpen] = useState(false);

  const current = activeHref(pathname, COMPACT_DESTINATIONS);
  const currentIsInSheet = SECONDARY_DESTINATIONS.some(
    (destination) => destination.href === current,
  );

  // A route change with the sheet open would otherwise leave it covering the
  // page that was just navigated to. Every link closes it on click, but the
  // back button does not go through them.
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Phone: bottom bar. */}
      <nav
        aria-label={t("mainLabel")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="flex items-stretch">
          {PRIMARY_DESTINATIONS.map((destination) => (
            <li className="flex-1" key={destination.href}>
              <BarLink
                current={current === destination.href}
                href={destination.href}
                label={t(destination.labelKey)}
                labelKey={destination.labelKey}
              />
            </li>
          ))}
          <li className="flex-1">
            <MoreButton
              containsCurrent={currentIsInSheet}
              containsCurrentLabel={t("moreContainsCurrent")}
              label={t("more")}
              onOpen={() => setSheetOpen(true)}
              open={isSheetOpen}
              variant="bar"
            />
          </li>
        </ul>
      </nav>

      {/* Tablet: side rail. */}
      <nav
        aria-label={t("mainLabel")}
        className="fixed inset-y-0 left-0 z-40 hidden w-32 flex-col border-r border-border bg-card md:flex lg:hidden"
      >
        <ul className="flex flex-col gap-2 p-2">
          {PRIMARY_DESTINATIONS.map((destination) => (
            <li key={destination.href}>
              <RailLink
                current={current === destination.href}
                href={destination.href}
                label={t(destination.labelKey)}
                labelKey={destination.labelKey}
              />
            </li>
          ))}
          <li>
            <MoreButton
              containsCurrent={currentIsInSheet}
              containsCurrentLabel={t("moreContainsCurrent")}
              label={t("more")}
              onOpen={() => setSheetOpen(true)}
              open={isSheetOpen}
              variant="rail"
            />
          </li>
        </ul>
      </nav>

      <NavSheet
        currentHref={current}
        onClose={() => setSheetOpen(false)}
        open={isSheetOpen}
      />
    </>
  );
}

/**
 * Marks the current destination without relying on colour.
 *
 * The fill is the obvious signal, but it is not the only one: the label goes
 * semibold and a solid bar sits against the edge the tier reads from. Someone
 * who cannot separate the two fills still has weight and shape (WCAG 1.4.1).
 */
function currentClasses(current: boolean, edge: "top" | "left"): string {
  const indicator = edge === "top" ? "border-t-4" : "border-l-4";

  return current
    ? `${indicator} border-primary bg-primary font-semibold text-primary-foreground`
    : `${indicator} border-transparent font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground`;
}

/** One destination in the phone's bottom bar. Target is 56px tall. */
function BarLink({
  current,
  href,
  label,
  labelKey,
}: {
  current: boolean;
  href: string;
  label: string;
  labelKey: string;
}): JSX.Element {
  const Icon = ICONS[labelKey];

  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={`flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 text-xs ${currentClasses(current, "top")}`}
      href={href}
    >
      {Icon ? <Icon aria-hidden="true" className="h-6 w-6" /> : null}
      <span className="text-center leading-tight">{label}</span>
    </Link>
  );
}

/** One destination in the tablet's rail. Target is 76px tall. */
function RailLink({
  current,
  href,
  label,
  labelKey,
}: {
  current: boolean;
  href: string;
  label: string;
  labelKey: string;
}): JSX.Element {
  const Icon = ICONS[labelKey];

  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={`flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-base ${currentClasses(current, "left")}`}
      href={href}
    >
      {Icon ? <Icon aria-hidden="true" className="h-7 w-7" /> : null}
      <span className="text-center leading-tight">{label}</span>
    </Link>
  );
}

/**
 * The control that opens the sheet, in whichever tier asked for it.
 *
 * It is a button and not a link because it opens a dialog rather than
 * navigating, and it says so with `aria-haspopup` and `aria-expanded`. When the
 * route you are on lives inside the sheet, it says that too — in words for a
 * screen reader and as a dot on screen — so the bar is never silent about where
 * you are.
 */
function MoreButton({
  containsCurrent,
  containsCurrentLabel,
  label,
  onOpen,
  open,
  variant,
}: {
  containsCurrent: boolean;
  containsCurrentLabel: string;
  label: string;
  onOpen: () => void;
  open: boolean;
  variant: "bar" | "rail";
}): JSX.Element {
  const isBar = variant === "bar";

  return (
    <button
      aria-expanded={open}
      aria-haspopup="dialog"
      className={`flex w-full flex-col items-center justify-center gap-1 ${
        isBar
          ? `min-h-[56px] px-1 py-2 text-xs ${currentClasses(containsCurrent, "top")}`
          : `min-h-[76px] rounded-md px-1 py-2 text-base ${currentClasses(containsCurrent, "left")}`
      }`}
      onClick={onOpen}
      type="button"
    >
      <Menu aria-hidden="true" className={isBar ? "h-6 w-6" : "h-7 w-7"} />
      <span className="text-center leading-tight">
        {label}
        {containsCurrent ? (
          <>
            <span aria-hidden="true"> ·</span>
            <span className="sr-only"> — {containsCurrentLabel}</span>
          </>
        ) : null}
      </span>
    </button>
  );
}
