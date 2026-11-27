"use client";

import Link from "next/link";
import { CookingPot, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/session/SignOutButton";
import type { JSX } from "react";

/** Who is signed in, as the shell has it from the session. */
export interface Account {
  name: string;
  email: string;
}

/**
 * Who is signed in, and the places no bar lists: the account panel on every
 * tier, opened from the circle at the top of the phone and the desktop and
 * from the foot of the tablet's rail (`DECISIONS.md` NAVIGATION).
 *
 * Configuración is here and nowhere else in the navigation: it is what gets
 * used least, and two taps to reach it is the price the owner chose for a
 * bar spent on what is done every day. The kitchen screen is here only on the
 * phone (`kitchen="phone"`): the rail and the top bar have a button of their
 * own for it, so their panel would be saying it twice.
 *
 * Signing out used to be at the foot of `/settings`, one screen and one
 * scroll from anywhere — on the shared tablet it exists for, the control
 * that matters most (owner's report, 2026-10-31). The address is shown
 * because on a shared device "whose session is this" is the question.
 */
export function AccountPanel({
  account,
  kitchen,
  onNavigate,
}: {
  account: Account;
  /** `"phone"`: offer the kitchen screen below `md`, where no bar has it. */
  kitchen?: "phone";
  /**
   * Closes whatever holds the panel when one of its links is followed. A
   * route change closes it too, but a link to the page already open changes
   * no route and would leave it covering that page.
   */
  onNavigate?: () => void;
}): JSX.Element {
  const t = useTranslations("navigation");

  return (
    <section aria-label={t("account")} className="space-y-3">
      <div className="flex items-center gap-3">
        <Avatar email={account.email} name={account.name} />
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{account.name}</p>
          <p className="break-all text-sm text-muted-foreground">
            {account.email}
          </p>
        </div>
      </div>
      <Button asChild className="w-full justify-start gap-2" variant="outline">
        <Link href="/settings" onClick={onNavigate}>
          <Settings aria-hidden="true" className="size-5" />
          {t("settings")}
        </Link>
      </Button>
      {kitchen ? (
        <Button
          asChild
          className="w-full justify-start gap-2 md:hidden"
          variant="outline"
        >
          <Link href="/kitchen" onClick={onNavigate}>
            <CookingPot aria-hidden="true" className="size-5" />
            {t("kitchenScreen")}
          </Link>
        </Button>
      ) : null}
      <SignOutButton />
    </section>
  );
}
