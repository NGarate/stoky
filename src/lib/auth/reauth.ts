import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { chargeRateLimit } from "@/server/trpc/throttle";
import {
  clientAddress,
  reauthAccountRateLimit,
  reauthRateLimit,
  refundRateLimit,
} from "@/lib/rate-limit";
import { readPasswordHash } from "@/lib/auth/credentials";
import { verifyPassword } from "@/lib/auth/password-hash";
import type { AppSession } from "@/lib/auth/session";
import { WRONG_CURRENT_PASSWORD_MESSAGE } from "@/lib/validations/password";
import { logSecurityEvent } from "@/lib/security-log";

/**
 * Re-entering the current password to confirm one action (PROGRESS D143).
 *
 * ASVS 5.0.0 7.5.2 asks that ending sessions be possible, and 7.5.1 that a
 * sensitive change ask again for the factor that proves who is asking: a
 * session left open on a kitchen tablet is not the person. So an action that
 * ends sessions or changes how the account signs in — the password itself
 * (D144), an owner ending every session in the household (D147), and later
 * its second factors — calls this first.
 *
 * **A confirmation, not an upgrade.** It answers yes for this one call; the
 * session is not marked as freshly authenticated and its token is not
 * rotated. ASVS 7.2.4 reads a re-authentication as an authentication, which
 * would rotate it; the owner accepted the deviation on 2026-10-15, and
 * SECURITY.md *Authentication* says why: nothing is granted beyond the action
 * being confirmed, and rotating from inside a tRPC call would need the
 * response's headers after they have been sent.
 *
 * The order is the point:
 *
 * 1. **No session id, no question.** The per-session budget is keyed on it,
 *    and the callers filter on it; Prisma reads `{ id: undefined }` as no
 *    condition at all.
 * 2. **Both budgets, before Argon2id.** Per session (`reauthRateLimit`), so a
 *    stolen session cannot spend the owner's way to evict it; per account
 *    (`reauthAccountRateLimit`), so ten sessions are not ten budgets.
 * 3. **The password**, through the same `verifyPassword` as sign-in. Wrong is
 *    BAD_REQUEST, never UNAUTHORIZED — the offline queue and the screens read
 *    that as a session that has ended — and logged here, because the refusal
 *    middleware records only UNAUTHORIZED, FORBIDDEN and TOO_MANY_REQUESTS.
 * 4. **Right gives the per-session attempt back**, to the window that
 *    counted it, so confirming several actions in a row never runs it out.
 *    The account's is kept: it is the backstop.
 */

/** What this needs of a tRPC context; the router's satisfies it. */
export interface ReauthContext {
  db: PrismaClient;
  session: AppSession;
  headers: Headers | null;
}

/** The action being confirmed, as `auth.reauth.refused` names it. */
export type ReauthVia = "end-sessions" | "password-change" | "household-end-all";

export const MISSING_SESSION_ID_MESSAGE =
  "This session cannot confirm an action. Sign in again.";

export async function confirmCurrentPassword(
  ctx: ReauthContext,
  password: string,
  via: ReauthVia,
): Promise<void> {
  const { sessionId } = ctx.session;
  const userId = ctx.session.user.id;
  if (!sessionId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: MISSING_SESSION_ID_MESSAGE });
  }

  const message = "Too many attempts at the password. Try again in a little while.";
  const window = await chargeRateLimit(reauthRateLimit(), sessionId, message);
  await chargeRateLimit(reauthAccountRateLimit(), userId, message);

  const storedHash = await readPasswordHash(ctx.db, userId);
  if (!(await verifyPassword(storedHash, password))) {
    logSecurityEvent("auth.reauth.refused", {
      userId,
      via,
      address: ctx.headers ? clientAddress(ctx.headers) : undefined,
    });
    throw new TRPCError({ code: "BAD_REQUEST", message: WRONG_CURRENT_PASSWORD_MESSAGE });
  }

  await refundRateLimit(reauthRateLimit(), sessionId, window);
}
