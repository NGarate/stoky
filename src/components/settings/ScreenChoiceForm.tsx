import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { chooseScreen } from "@/lib/landing/choose";
import type { LandingScreen } from "@/generated/prisma/browser";
import type { JSX } from "react";

/**
 * The three screens, as one question (`REDESIGN_PLAN.md` §5.1).
 *
 * Rendered in two places — `/start` asks it once, `/settings/screen` lets it be
 * changed — and shared rather than written twice, because two copies of one
 * question is how a product ends up describing the kitchen screen differently
 * depending on where you were standing when it asked.
 *
 * **A server component with no client JavaScript.** Three submit buttons in one
 * form, each carrying its own value, posting to a server action that writes the
 * row and decides where to go next. `/start` is the first screen somebody meets
 * after signing in, and a question that works before hydration is a question
 * that always works.
 *
 * Three buttons rather than radios and a Confirm, because the answer *is* the
 * action — a two-step form would make somebody choose twice.
 */
export async function ScreenChoiceForm({
  current,
  then,
}: {
  /** What is chosen today, marked so the person can see it before changing it. */
  current?: LandingScreen | undefined;
  /** `go` takes them to the screen they picked; `stay` returns here. */
  then: "go" | "stay";
}): Promise<JSX.Element> {
  const t = await getTranslations("start");

  const options = [
    { screen: "SHOPPING", name: t("shopping"), what: t("shoppingWhat") },
    { screen: "KITCHEN", name: t("kitchen"), what: t("kitchenWhat") },
    { screen: "DASHBOARD", name: t("dashboard"), what: t("dashboardWhat") },
  ] as const;

  return (
    <form action={chooseScreen}>
      <input name="then" type="hidden" value={then} />
      <ul className="space-y-4">
        {options.map((option) => {
          const isCurrent = option.screen === current;
          return (
            <li key={option.screen}>
              {/* A submit button rather than a link: choosing is a write, and
                  §5.1's promise is that it is remembered. A link would land
                  them once and ask again tomorrow.

                  The `Button` primitive, overridden to stack rather than sit on
                  one line, so the 48px floor is inherited rather than retyped —
                  the rule `target-floor.test.ts` enforces. */}
              <Button
                aria-current={isCurrent ? "true" : undefined}
                className="w-full flex-col items-start gap-1 whitespace-normal py-4 text-left"
                name="screen"
                type="submit"
                value={option.screen}
                variant={isCurrent ? "default" : "outline"}
              >
                <span className="text-lg font-semibold">
                  {option.name}
                  {/* In words, not by colour alone. The filled variant says the
                      same thing to somebody who can see it; this says it to
                      everybody else. */}
                  {isCurrent ? (
                    <span className="ml-2 text-sm font-normal">
                      {t("currentSuffix")}
                    </span>
                  ) : null}
                </span>
                <span className="text-sm font-normal opacity-90">
                  {option.what}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
    </form>
  );
}
