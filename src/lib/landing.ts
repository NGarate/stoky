import type { HouseholdRole, LandingScreen } from "@/generated/prisma/browser";

/**
 * Where a person lands, and who decides it (`REDESIGN_PLAN.md` §5.1,
 * Journey 8).
 *
 * Kept pure and separate from the route that uses it, because the interesting
 * part is a three-way precedence that is easy to state and easy to get subtly
 * wrong, and it deserves to be asserted without a database, a session or a
 * browser.
 */

/** The three screens that exist, and the routes they are. */
export const SCREEN_PATHS: Record<LandingScreen, string> = {
  DASHBOARD: "/dashboard",
  SHOPPING: "/shopping",
  KITCHEN: "/kitchen",
};

/** Where somebody goes to be asked. */
export const CHOOSE_PATH = "/start";

/**
 * The landing decision.
 *
 * Precedence, in order, and each step is a sentence from §5.1:
 *
 * 1. **A choice made on this device wins.** "Asked once, then remembered for
 *    that combination" — including for a kitchen account, because the choice
 *    is changeable from settings and a setting that the next visit overrules
 *    is not a setting.
 * 2. **A kitchen account lands on the kitchen screen without being asked.**
 *    "The role sets the default." It is a default rather than a rule, which is
 *    why step 1 is above it.
 * 3. **Anyone else is asked**, once.
 *
 * Note what is deliberately *not* here: a fallback to `/dashboard` for the
 * unasked. That was today's behaviour and it is exactly what made the question
 * never get asked — somebody who lands somewhere reasonable is never offered
 * the choice, and §5.1 has gone unbuilt through two phases partly because of
 * it.
 */
export function landingPath({
  role,
  choice,
}: {
  role: HouseholdRole | undefined;
  /** What this person chose on this device, if they have. */
  choice: LandingScreen | undefined;
}): string {
  if (choice) return SCREEN_PATHS[choice];
  if (role === "KITCHEN") return SCREEN_PATHS.KITCHEN;
  return CHOOSE_PATH;
}

/** Whether a value is one of the three screens, for anything crossing a wire. */
export function isLandingScreen(value: unknown): value is LandingScreen {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SCREEN_PATHS, value)
  );
}
