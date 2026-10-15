import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Ending sessions, which is deleting their rows, in one place.
 *
 * A session is a `Session` row and nothing else: Better Auth reads the row on
 * every request (the cookie cache is off, `src/lib/auth/instance.ts`), so a
 * deleted row is a session that has ended everywhere at once. Everything that
 * ends sessions — a person ending their own, an admin ending a member's, a
 * password being set — comes through here, so what "ended" means can change
 * in one file.
 *
 * Deliberately free of `@/` imports, like `credentials.ts`, which calls it and
 * which `prisma/seed.ts` imports by relative path.
 */

/** The root client, or the one an interactive transaction hands its callback. */
export type SessionDb = PrismaClient | Prisma.TransactionClient;

/**
 * Deletes every session matching `where` and returns how many it deleted,
 * with the two-step sign-ins in progress for the accounts it names
 * (`endTwoFactorChallenges`).
 *
 * **Refuses a filter with a missing value.** Prisma reads `{ userId:
 * undefined }` as "no condition", so a caller that lost its id on the way
 * here would end every session on the instance. An empty filter is refused for
 * the same reason: nothing here ever means "everyone". So is a missing value
 * one level down — `{ id: { not: undefined } }`, "every session but this
 * one" asked by a caller that has no "this one", is no condition either
 * (D143).
 */
export async function endSessions(
  db: SessionDb,
  where: Prisma.SessionWhereInput,
  { challenges = true }: EndSessionsOptions = {},
): Promise<number> {
  const entries = Object.entries(where);
  const missing = (value: unknown) =>
    value === undefined ||
    (value !== null &&
      typeof value === "object" &&
      Object.values(value).some((inner) => inner === undefined));
  if (entries.length === 0 || entries.some(([, value]) => missing(value))) {
    throw new Error("endSessions refuses a filter that would match every session");
  }
  const accounts = challenges ? await accountsNamed(db, where) : [];
  const { count } = await db.session.deleteMany({ where });
  await endTwoFactorChallenges(db, accounts);
  return count;
}

export interface EndSessionsOptions {
  /**
   * False to leave the accounts' two-step challenges alone, for the sign-in's
   * own housekeeping (`src/lib/auth/sign-in-tidy.ts`) and nothing else: the
   * session a browser presented, the account's expired rows and the ones past
   * the cap. Those end because a sign-in happened, not because anybody chose
   * to end the account's sign-ins, and a challenge there may be the sign-in in
   * progress — this one, or the same person's on another device. Every
   * deliberate end (a password reset or change, a removal, "end these
   * sessions") takes the challenges with it.
   */
  challenges?: boolean;
}

/**
 * Whose two-step challenges go with these sessions: every account a matched
 * session belongs to, and the account the filter names — by `userId`, with
 * any `user` condition beside it — whether or not it had a session left. A
 * challenge has no session: Better Auth deletes the one the password step
 * made, so "end Ana's sessions" would otherwise leave Ana's challenge alone.
 */
async function accountsNamed(db: SessionDb, where: Prisma.SessionWhereInput): Promise<string[]> {
  const found = new Set<string>();
  const sessions = await db.session.findMany({
    where,
    select: { userId: true },
    distinct: ["userId"],
  });
  for (const { userId } of sessions) found.add(userId);

  const user: Prisma.UserWhereInput = {};
  if (typeof where.userId === "string") user.id = where.userId;
  const related = where.user;
  if (related && typeof related === "object" && !("is" in related) && !("isNot" in related)) {
    Object.assign(user, related);
  }
  if (Object.keys(user).length > 0) {
    for (const { id } of await db.user.findMany({ where: user, select: { id: true } })) {
      found.add(id);
    }
  }
  return [...found];
}

/** Better Auth's prefix for a two-step challenge's `Verification` row. */
export const TWO_FACTOR_CHALLENGE_PREFIX = "2fa-";

/**
 * Ends the two-step sign-ins these accounts have in progress (PROGRESS D148),
 * and returns how many.
 *
 * A challenge is what the password step leaves: a `Verification` row
 * `2fa-…` whose value is the account's id, named by the browser's signed
 * `two_factor` cookie, which the authenticator code then turns into a
 * session. It is half a sign-in, and whoever holds it already has the
 * password, so it goes wherever the account's sessions go: a password reset,
 * a removal, "end every session". Its attempt counter (`2fa-attempts-<id>`,
 * whose value is a number, not an account) goes with it.
 */
export async function endTwoFactorChallenges(db: SessionDb, userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const challenges = await db.verification.findMany({
    where: { identifier: { startsWith: TWO_FACTOR_CHALLENGE_PREFIX }, value: { in: userIds } },
    select: { identifier: true },
  });
  if (challenges.length === 0) return 0;
  const identifiers = challenges.map(({ identifier }) => identifier);
  await db.verification.deleteMany({
    where: {
      identifier: {
        in: [...identifiers, ...identifiers.map((id) => `${TWO_FACTOR_CHALLENGE_PREFIX}attempts-${id}`)],
      },
    },
  });
  return challenges.length;
}
