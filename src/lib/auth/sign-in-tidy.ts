import type { Prisma } from "@prisma/client";
import { logSecurityEvent } from "@/lib/security-log";
import { endSessions, type SessionDb } from "@/lib/auth/end-sessions";

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

/**
 * Ends the presented session and deletes the account's expired rows, never the
 * session just issued. Returns how many rows went.
 *
 * Writes `auth.session.ended` with `reason: "replaced"` when a session was
 * presented: `userId` signed in, `targetUserId` held the session it replaced,
 * and `count` is every row the tidy deleted, the account's expired ones
 * included. Expired rows on their own write nothing, like any session that
 * ran out.
 */
export async function tidyAfterSignIn(
  db: SessionDb,
  input: SignInTidy,
  now: Date = new Date(),
): Promise<number> {
  const count = await endSessions(db, signInTidyFilter(input, now));
  if (input.previous) {
    logSecurityEvent("auth.session.ended", {
      reason: "replaced",
      userId: input.userId,
      targetUserId: input.previous.userId,
      count,
    });
  }
  return count;
}
