import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * A step-up: one session's proof that its person re-entered the password a
 * moment ago, spent by the one change it was asked for (PROGRESS D151, ASVS
 * 5.0.0 7.5.1).
 *
 * Adding a passkey or removing one changes how the account signs in, so a
 * session alone must not be enough — a tablet left signed in is not its
 * owner. Better Auth's passkey endpoints ask only for a session, and they
 * take a WebAuthn ceremony, not a password, so the password is confirmed
 * first through tRPC (`auth.confirmPassword`, with the D143 budgets) and the
 * confirmation is left here for the auth API to find
 * (`src/lib/auth/policy-plugin.ts`).
 *
 * It is a `Verification` row, `stoky-step-up:<session id>`, holding the
 * account's id and lasting five minutes:
 *
 * - **Bound to the session**, by the id in its name: another session of the
 *   same account — the tablet — cannot spend it.
 * - **Single-use**: the registration and the removal delete it as they check
 *   it, in one statement, so two requests cannot both pass. Asking for the
 *   registration options only looks: the ceremony that follows spends it.
 * - **Gone with its session**: `endSessions` deletes the rows of the sessions
 *   it ends. A row whose session ended some other way (a sign-out, Better
 *   Auth's own deletes) is spent by nobody, because the check needs that
 *   session, and lapses in five minutes.
 *
 * Free of `@/` imports, like `end-sessions.ts`, which imports the prefix.
 */

/** The `Verification.identifier` prefix; the session's id follows it. */
export const STEP_UP_PREFIX = "stoky-step-up:";

/** How long a confirmed password stands for one change: five minutes. */
export const STEP_UP_TTL_S = 5 * 60;

/** The refusal's code, which the browser words (`src/lib/auth/error-messages.ts`). */
export const STEP_UP_REQUIRED = "STEP_UP_REQUIRED";

export type StepUpDb = Pick<PrismaClient, "verification"> | Pick<Prisma.TransactionClient, "verification">;

export function stepUpIdentifier(sessionId: string): string {
  return `${STEP_UP_PREFIX}${sessionId}`;
}

/**
 * Records that this session's person has just re-entered the password, and
 * returns when that lapses. Any earlier one of the same session is replaced,
 * so a session holds one at most.
 */
export async function grantStepUp(
  db: StepUpDb,
  { sessionId, userId }: { sessionId: string; userId: string },
  now: Date = new Date(),
): Promise<Date> {
  if (!sessionId || !userId) throw new Error("grantStepUp needs a session and its account");
  const identifier = stepUpIdentifier(sessionId);
  const expiresAt = new Date(now.getTime() + STEP_UP_TTL_S * 1000);
  await db.verification.deleteMany({ where: { identifier } });
  await db.verification.create({ data: { identifier, value: userId, expiresAt } });
  return expiresAt;
}

/**
 * Whether this session holds a live step-up for this account. `spend` deletes
 * it in the same statement that finds it, so of two requests only one is
 * answered yes.
 */
export async function hasStepUp(
  db: StepUpDb,
  { sessionId, userId, spend }: { sessionId: string; userId: string; spend: boolean },
  now: Date = new Date(),
): Promise<boolean> {
  if (!sessionId || !userId) return false;
  const where = { identifier: stepUpIdentifier(sessionId), value: userId, expiresAt: { gt: now } };
  if (spend) return (await db.verification.deleteMany({ where })).count > 0;
  return (await db.verification.count({ where })) > 0;
}
