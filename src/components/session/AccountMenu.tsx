"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AccountPanel, type Account } from "./AccountPanel";
import type { JSX } from "react";

/**
 * The desktop's account control: a circle at the end of the top bar that
 * opens `AccountPanel`, where GitHub, Google and most of the web put it.
 *
 * A dialog rather than a dropdown menu, because what it holds is not a list
 * of commands — signing out unfolds a question in place — and `Dialog`
 * already traps focus, closes on Escape and gives focus back. It is drawn
 * under the circle rather than in the middle of the screen, so it reads as
 * the circle's.
 */
export function AccountMenu({ account }: { account: Account }): JSX.Element {
  const t = useTranslations("navigation");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  // "Seguridad y acceso" navigates; the panel should not follow.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <Button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("accountOf", { name: account.name })}
        onClick={() => setOpen(true)}
        ref={opener}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Avatar email={account.email} name={account.name} />
      </Button>
      <Dialog
        className="top-20 right-4 left-auto max-w-sm translate-x-0 translate-y-0"
        onClose={() => setOpen(false)}
        open={open}
        returnFocus={opener}
        title={t("account")}
      >
        <AccountPanel account={account} />
      </Dialog>
    </>
  );
}
