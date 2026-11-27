"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  CircleUser,
  CookingPot,
  House,
  Package,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AccountSheet } from "./AccountSheet";
import type { Account } from "@/components/session/AccountPanel";
import { DESTINATIONS, PHONE_DESTINATIONS, activeHref } from "./navigation";
import type { ComponentType, JSX, SVGProps } from "react";

/** One glyph per destination, the mock-up's. */
const ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  "/dashboard": House,
  "/shopping": ShoppingCart,
  "/inventory": Package,
  "/receipts": Receipt,
  "/kitchen": CookingPot,
};

/**
 * The phone and tablet navigation (`DECISIONS.md` NAVIGATION, arrangement B).
 *
 * - **Phone** (base → `md`): a bottom bar with four destinations that never
 *   move — Inicio, Compra, Inventario, Tickets — and, at the top of the
 *   screen, a strip with the wordmark and the account circle, the page's
 *   banner. Not a hamburger: the destinations stay visible instead of hiding
 *   behind a control someone has to know to press (DESIGN_AUDIT A3.6). The
 *   account goes up there, far from the thumb, because Configuración and the
 *   kitchen screen behind it are what gets used least.
 * - **Tablet** (`md` → `lg`): a side rail with the same four in the same
 *   order, then Cocina, which is what the tablet is for (SCREENS), and the
 *   account at its foot. A bottom bar would spend the most valuable strip of
 *   a screen read from a metre away. Bigger type and bigger targets than the
 *   phone, because it is the least dense tier (D14). Six 76px targets are
 *   taller than a phone held sideways, so the rail scrolls rather than cut
 *   the account off.
 *
 * Both open the same account sheet. Only one tier is ever rendered visibly,
 * which is why the two `<nav>`s can share the accessible name: a hidden
 * `<nav>` is not in the accessibility tree, so the landmark stays unique at
 * every width.
 */
export function CompactNav({ account }: { account: Account }): JSX.Element {
  const t = useTranslations("navigation");
  const pathname = usePathname();
  const [isSheetOpen, setSheetOpen] = useState(false);
  const current = activeHref(pathname);

  // A route change with the sheet open would otherwise leave it covering the
  // page that was just navigated to. Its links close it on the way, even to
  // the page already open, but the back button does not go through them.
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Phone: the account, top right, above the screen's own title. The
          sheet gives focus back to whatever had it when it opened, which is
          this circle or the rail's button. */}
      <header className="flex items-center justify-between gap-2 px-4 pt-2 md:hidden">
        <Button asChild className="min-w-[48px]" variant="link">
          <Link href="/dashboard">Stoky</Link>
        </Button>
        <Button
          aria-expanded={isSheetOpen}
          aria-haspopup="dialog"
          aria-label={t("accountOf", { name: account.name })}
          className="rounded-full"
          onClick={() => setSheetOpen(true)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Avatar email={account.email} name={account.name} />
        </Button>
      </header>

      {/* Phone: bottom bar.

          `data-fixed-bottom` is a contract, not decoration: it marks the
          element that covers the bottom of the viewport, so a popup can ask how
          much room it really has instead of trusting `window.innerHeight`. The
          location picker opened its panel into the 64px underneath this bar and
          drew every option behind it (ISSUES UI-6). One attribute is cheaper
          than teaching each popup about this component. */}
      <nav
        aria-label={t("mainLabel")}
        data-fixed-bottom=""
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="flex items-stretch">
          {PHONE_DESTINATIONS.map((destination) => (
            <li className="min-w-0 flex-1" key={destination.href}>
              <DestinationLink
                current={current === destination.href}
                href={destination.href}
                label={t(destination.labelKey)}
                tier="bar"
              />
            </li>
          ))}
        </ul>
      </nav>

      {/* Tablet: side rail, with the account at its foot. */}
      <nav
        aria-label={t("mainLabel")}
        className="fixed inset-y-0 left-0 z-40 hidden w-32 flex-col justify-between overflow-y-auto border-r border-border bg-card p-2 md:flex lg:hidden"
      >
        <ul className="flex flex-col gap-2">
          {DESTINATIONS.map((destination) => (
            <li key={destination.href}>
              <DestinationLink
                current={current === destination.href}
                href={destination.href}
                label={t(destination.labelKey)}
                tier="rail"
              />
            </li>
          ))}
        </ul>
        <button
          aria-expanded={isSheetOpen}
          aria-haspopup="dialog"
          className="flex min-h-[76px] w-full flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-base text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() => setSheetOpen(true)}
          type="button"
        >
          <CircleUser aria-hidden="true" className="h-7 w-7" />
          <span className="text-center leading-tight">{t("account")}</span>
        </button>
      </nav>

      <AccountSheet
        account={account}
        onClose={() => setSheetOpen(false)}
        open={isSheetOpen}
      />
    </>
  );
}

/**
 * One destination, in the phone's bar (64px tall) or the tablet's rail (76px).
 *
 * The current one is marked three ways, none of them colour alone (WCAG
 * 1.4.1): its icon sits in a filled pill, its label goes bold, and it carries
 * `aria-current="page"`. The mock-up's pill, Material 3's indicator.
 */
function DestinationLink({
  current,
  href,
  label,
  tier,
}: {
  current: boolean;
  href: string;
  label: string;
  tier: "bar" | "rail";
}): JSX.Element {
  const Icon = ICONS[href];
  const isBar = tier === "bar";

  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={`flex flex-col items-center justify-center gap-1 px-1 py-2 ${
        isBar ? "min-h-[64px] text-xs" : "min-h-[76px] rounded-md text-base"
      } ${
        current
          ? "font-bold text-heading"
          : "font-normal text-muted-foreground hover:text-foreground"
      }`}
      href={href}
    >
      <span
        aria-hidden="true"
        className={`grid h-8 w-14 place-items-center rounded-full ${
          current ? "bg-primary text-primary-foreground" : ""
        }`}
      >
        {Icon ? <Icon className={isBar ? "h-6 w-6" : "h-7 w-7"} /> : null}
      </span>
      <span className="max-w-full text-center leading-tight">{label}</span>
    </Link>
  );
}
