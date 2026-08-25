import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { chooseScreen } from "@/lib/landing/choose";
import type { JSX } from "react";

/**
 * "Which screen do you want to start on?" — asked once per person per device
 * (`REDESIGN_PLAN.md` §5.1, Journey 8).
 *
 * **No client JavaScript.** Three submit buttons in one form, each carrying its
 * own value, posting to a server action that writes the row and redirects. That
 * is not minimalism for its own sake: this is the first screen somebody meets
 * after signing in, it is one question, and a question that works before
 * hydration is a question that always works.
 *
 * Three buttons rather than radios and a Confirm, because the answer *is* the
 * action — a two-step form would make somebody choose twice. Each one names the
 * screen and says what it is for, since "Panel" alone means nothing to a person
 * who has not seen it yet.
 *
 * Outside the `(dashboard)` group deliberately: the navigation is a way to move
 * between screens, and this is the moment before there is a screen to move from.
 */
export default async function StartPage(): Promise<JSX.Element> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const t = await getTranslations("start");

  const options = [
    { screen: "SHOPPING", name: t("shopping"), what: t("shoppingWhat") },
    { screen: "KITCHEN", name: t("kitchen"), what: t("kitchenWhat") },
    { screen: "DASHBOARD", name: t("dashboard"), what: t("dashboardWhat") },
  ] as const;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold text-heading">{t("title")}</h1>
      <p className="mt-3 text-muted-foreground">{t("intro")}</p>

      <form action={chooseScreen}>
        <ul className="mt-8 space-y-4">
          {options.map((option) => (
            <li key={option.screen}>
              {/* A submit button rather than a link: choosing is a write, and
                  §5.1's promise is that it is remembered. A link would land
                  them once and ask again tomorrow.

                  The `Button` primitive, overridden to stack rather than to
                  sit on one line — so the 48px floor is inherited rather than
                  retyped here, which is the rule `target-floor.test.ts`
                  enforces. */}
              <Button
                className="w-full flex-col items-start gap-1 whitespace-normal py-4 text-left"
                name="screen"
                type="submit"
                value={option.screen}
                variant="outline"
              >
                <span className="text-lg font-semibold">{option.name}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {option.what}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </form>

      <p className="mt-8 text-sm text-muted-foreground">{t("changeLater")}</p>
    </main>
  );
}
