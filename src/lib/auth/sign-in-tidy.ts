import type { Prisma, PrismaClient } from "@prisma/client";
import { logSecurityEvent } from "@/lib/security-log";
import { endSessions, type SessionDb } from "@/lib/auth/end-sessions";
import { MAX_SESSIONS_PER_ACCOUNT } from "@/lib/auth/session-policy";

/**
 * What a successful sign-in leaves behind it (PROGRESS D139).
 *
 * **The session the browser presented ends** (ASVS 5.0.0 7.2.4: a new
 * authentication terminates the session it replaces). Better Auth issues a new
 * token at every sign-in and leaves the old row alone, so a browser that signs
 * in again — after the idle warning, or as somebody else on a shared tablet —
 * would otherwise leave a live session behind whose cookie it no longer holds
 * but a copy of which still works. It ends whoever it belonged to: on a
 * shared tablet that is the previous person, and that is the point.
 *
 * **The account's expired rows go too.** Better Auth deletes an expired row
 * only when its cookie is read again, and a browser that was closed never
 * sends it; without this, every closed browser leaves a row until the account
 * is deleted (SECURITY.md, personal-data table). A sign-in is the moment the
 * account is in front of us anyway.
 *
 * **Then the account is held to ten sessions** (PROGRESS D140, ASVS 5.0.0
 * 7.1.2): the sign-in that would make the eleventh ends the least recently
 * used, by `updatedAt`. After the tidy, not before, so signing in again in
 * the same browser — which has just ended the session it presented — never
 * costs another device its session.
 *
 * Called by the auth route after every sign-in that issued a session
 * (`src/server/http/auth-handler.ts`) — the password step now, and the
 * two-step and passkey sign-ins when they arrive. Never from a session-create
 * hook: Better Auth creates a session it then deletes at the password step of
 * an account with two-step verification, and a hook would tidy on a password
 * alone.
 */

/** The session a sign-in request presented, as the route read it. */
export interface PresentedSession {
  id: string;
  /** Whose it was — not necessarily who is signing in now. */
  userId: string;
}

export interface SignInTidy {
  /** The valid session the request carried, or null when it carried none. */
  previous: PresentedSession | null;
  /** The account that just signed in. */
  userId: string;
  /** The token of the session the sign-in issued, which is never ended here. */
  newToken: string;
}

/**
 * The rows a sign-in ends, as one filter.
 *
 * **The id clause is left out, not left empty, when nothing was presented.**
 * Prisma drops an `undefined` field, so `{ id: undefined }` is `{}`, and what
 * an `OR` makes of an empty clause is the client's choice rather than ours:
 * Prisma 6.19 reads it as matching nothing (measured for D139), and a filter
 * whose meaning depends on that is one upgrade from matching every session on
 * the instance. `endSessions` refuses a missing value at the top level only,
 * so this is the place that has to get it right.
 */
export function signInTidyFilter(
  { previous, userId, newToken }: SignInTidy,
  now: Date,
): Prisma.SessionWhereInput {
  if (!userId || !newToken) {
    throw new Error("tidyAfterSignIn needs the account and the new session's token");
  }
  return {
    OR: [
      ...(previous?.id ? [{ id: previous.id }] : []),
      { userId, expiresAt: { lt: now } },
    ],
    NOT: { token: newToken },
  };
}

/** Whose sessions the cap counts, and the one it never ends. */
export interface SessionCap {
  userId: string;
  /** The token of the session the sign-in issued. */
  keepToken: string;
}

/**
 * Ends the account's sessions beyond `MAX_SESSIONS_PER_ACCOUNT`, least
 * recently used first, never `keepToken`'s. Returns how many it ended.
 *
 * "Least recently used" is the oldest `updatedAt`, ties broken by the oldest
 * `createdAt`, then the id, so the choice is the same on every run.
 * `updatedAt` is only as current as the writes that move it, and there are
 * two. A browser session's moves with the keep-alive's slide (`auth.session`),
 * which asks at most every four minutes of activity and writes when more than
 * a minute has passed, so the row trails real use by about five minutes at
 * most. A remembered session's (D141) moves with Better Auth's daily refresh
 * on a tRPC read (`readSession`), so it trails real use by up to a day. There
 * is no `lastSeen` column, because a write per request is exactly what D135
 * took away.
 *
 * Meant to run inside `tidyAfterSignIn`'s transaction, which holds the
 * account's `User` row, so two sign-ins of one account count one after the
 * other. Without it the count still comes out at ten — every sign-in's row
 * exists before its own cap reads the list, so the last cap to read sees them
 * all — but two transactions deleting overlapping rows (the same expired
 * ones, the same least-used ones) lock them in no promised order, and
 * Postgres resolves that by aborting one: a tidy that fails for no reason of
 * its own.
 */
export async function capSessions(db: SessionDb, { userId, keepToken }: SessionCap): Promise<number> {
  if (!userId || !keepToken) {
    throw new Error("capSessions needs the account and the token it keeps");
  }
  const beyond = await db.session.findMany({
    where: { userId, NOT: { token: keepToken } },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    // Past the nine most recently used: with the new session, those are ten.
    skip: MAX_SESSIONS_PER_ACCOUNT - 1,
    select: { id: true },
  });
  if (beyond.length === 0) return 0;
  return endSessions(db, { userId, id: { in: beyond.map(({ id }) => id) } });
}

/** What a sign-in's tidy ended. */
export interface TidyResult {
  /** The presented session and the account's expired rows. */
  replaced: number;
  /** Sessions beyond the cap, least recently used first. */
  evicted: number;
}

/** A client that can open a transaction: the tidy takes its own. */
export type TidyDb = Pick<PrismaClient, "$transaction">;

/**
 * Ends the presented session, deletes the account's expired rows and holds
 * the account to `MAX_SESSIONS_PER_ACCOUNT`, never touching the session just
 * issued — in one transaction that holds the account's `User` row
 * `FOR UPDATE`, so concurrent sign-ins of one account take their turn and the
 * last of them still leaves ten.
 *
 * Writes `auth.session.ended` with `reason: "replaced"` when a session was
 * presented: `userId` signed in, `targetUserId` held the session it replaced,
 * and `count` is every row the tidy deleted, the account's expired ones
 * included. Expired rows on their own write nothing, like any session that
 * ran out. Sessions the cap ended are a line of their own, `reason:
 * "evicted"`, with the account as both `userId` and `targetUserId`. Both are
 * written once the transaction has committed, so a line never describes a
 * delete that was rolled back.
 */
export async function tidyAfterSignIn(
  db: TidyDb,
  input: SignInTidy,
  now: Date = new Date(),
): Promise<TidyResult> {
  // Built before the transaction, so a missing account or token throws
  // without opening one.
  const filter = signInTidyFilter(input, now);
  const result = await db.$transaction(async (tx) => {
    // A tagged template, so the id is a bound parameter.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
    const replaced = await endSessions(tx, filter);
    const evicted = await capSessions(tx, { userId: input.userId, keepToken: input.newToken });
    return { replaced, evicted };
  });
  if (input.previous) {
    logSecurityEvent("auth.session.ended", {
      reason: "replaced",
      userId: input.userId,
      targetUserId: input.previous.userId,
      count: result.replaced,
    });
  }
  if (result.evicted > 0) {
    logSecurityEvent("auth.session.ended", {
      reason: "evicted",
      userId: input.userId,
      targetUserId: input.userId,
      count: result.evicted,
    });
  }
  return result;
}
