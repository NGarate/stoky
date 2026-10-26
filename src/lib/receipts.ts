import { MatchStatus } from "@/generated/prisma/browser";

/**
 * Has the reviewer dealt with this line?
 *
 * Confirmed, created and skipped are all decisions. `PENDING` and
 * `AUTO_MATCHED` are not: the parser proposed something and nobody has looked
 * at it yet.
 *
 * It lives here rather than in either place that asks, because the two used to
 * disagree. `ReviewCard` drew its badge from this rule while the page counted
 * with a `useState(0)` that had no setter, so the heading said "4 productos
 * pendientes" under four cards all reading "Confirmado" (ISSUES UI-7). The same
 * trap as `getAppliedSummary` in `PROGRESS.md` D18: two definitions of the same
 * word, one of them wrong.
 */
export function isItemReviewed(matchStatus: string): boolean {
  return (
    matchStatus === MatchStatus.USER_CONFIRMED ||
    matchStatus === MatchStatus.USER_CREATED ||
    matchStatus === MatchStatus.SKIPPED
  );
}
