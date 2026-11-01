"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { withFrom } from "@/lib/back";
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
 * Who is signed in, and what only they can do: the "Más" sheet's head on a
 * phone or tablet, and the account dialog on a desktop.
 *
 * Signing out used to be at the foot of `/settings`, one screen and one
 * scroll from anywhere — on the shared tablet it exists for, the control
 * that matters most (owner's report, 2026-10-31). The address is shown
 * because on a shared device "whose session is this" is the question.
 *
 * Settings is not repeated here: it is a destination in every tier's
 * navigation already.
 */
export function AccountPanel({ account }: { account: Account }): JSX.Element {
  const t = useTranslations("navigation");
  const pathname = usePathname();
  const tSecurity = useTranslations("security");

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
        <Link href={withFrom("/settings/security", pathname)}>
          <ShieldCheck aria-hidden="true" className="size-5" />
          {tSecurity("title")}
        </Link>
      </Button>
      <SignOutButton />
    </section>
  );
}
