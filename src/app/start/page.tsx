import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ScreenChoiceForm } from "@/components/settings/ScreenChoiceForm";
import type { JSX } from "react";

/**
 * "Which screen do you want to start on?" — asked once per person per device
 * (`REDESIGN_PLAN.md` §5.1, Journey 8).
 *
 * Outside the `(dashboard)` group deliberately: the navigation is a way to move
 * between screens, and this is the moment before there is a screen to move
 * from. The question itself is `ScreenChoiceForm`, shared with
 * `/settings/screen` so the two places that ask it cannot describe the screens
 * differently.
 */
export default async function StartPage(): Promise<JSX.Element> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const t = await getTranslations("start");

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold text-heading">{t("title")}</h1>
      <p className="mt-3 text-muted-foreground">{t("intro")}</p>

      <div className="mt-8">
        <ScreenChoiceForm then="go" />
      </div>

      <p className="mt-8 text-sm text-muted-foreground">{t("changeLater")}</p>
    </main>
  );
}
