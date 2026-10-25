import { TRPCError } from "@trpc/server";
import { isAPIError } from "better-auth/api";
import { getAuth } from "@/lib/auth/instance";
import { WRONG_CURRENT_PASSWORD_MESSAGE } from "@/lib/validations/password";

/**
 * A signed-in person's own password, written through Better Auth so that the
 * device asking stays signed in (PROGRESS D144).
 *
 * `auth.changePassword` has already checked the current password and the
 * identity rule by the time this runs (`src/server/trpc/routers/auth.ts`);
 * this is the write. Better Auth's `changePassword` with
 * `revokeOtherSessions` sets the hash, deletes every session the account
 * has, creates one new session for the request and sets its cookie — through
 * `nextCookies`, into the tRPC route's answer. The create hook in
 * `src/lib/auth/instance.ts` carries `authenticatedAt` and `persistent` over
 * from the session that asked, so the day's limit still counts from the
 * sign-in and a remembered device stays remembered; `deviceId` is read from
 * the same request. A copy of the old cookie is refused afterwards, because
 * its row is gone (ASVS 5.0.0 7.4.3: the other sessions end, this one's
 * token rotates).
 *
 * **A request that carried no cookie keeps nothing.** That is a native client
 * on a bearer token (D142): it keeps no cookies, so a rotated session would be
 * a row nobody can present, and the token it holds is the old one. Better
 * Auth is asked only for the hash, and the caller ends every session the
 * account has, this one with them — what D142 promised a password change does
 * to a native session.
 *
 * Better Auth checks the current password again, which is the cost of not
 * writing the hash and the sessions ourselves: a second Argon2id run. It
 * also hashes the new one before it checks, so the order of checks that
 * matters — the budget, then the password, then the identity rule — is the
 * router's, and this is called only after all three passed. Its answer for a
 * wrong password (possible only if the password changed in between) is the
 * router's own `BAD_REQUEST`.
 *
 * **Not one transaction.** Better Auth writes the hash, then deletes the
 * sessions, then creates the new one, as three statements. A failure between
 * the first two would leave the new password beside sessions that should have
 * ended, which the old procedure's single transaction ruled out; the person
 * is told the change failed and can end them from **Tus dispositivos**.
 * SECURITY.md *Authentication* records it.
 */

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}

/** The one Better Auth endpoint this calls, injectable for its unit test. */
export type ChangePasswordCall = (request: {
  body: PasswordChangeInput & { revokeOtherSessions: boolean };
  headers: Headers;
}) => Promise<unknown>;

export interface PasswordChangeOutcome {
  /**
   * Whether this request's session was replaced by a new one that keeps it
   * signed in. False for a request with no cookie, whose sessions the caller
   * must then end — every one, this one's included.
   */
  rotated: boolean;
}

const callBetterAuth: ChangePasswordCall = (request) =>
  getAuth().api.changePassword(request);

export async function changeOwnPassword(
  headers: Headers,
  input: PasswordChangeInput,
  call: ChangePasswordCall = callBetterAuth,
): Promise<PasswordChangeOutcome> {
  const rotated = headers.has("cookie");
  try {
    await call({
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: rotated,
      },
      headers,
    });
  } catch (error) {
    throw refusalFor(error);
  }
  return { rotated };
}

/** Better Auth's refusal, as the router's callers already read refusals. */
function refusalFor(error: unknown): unknown {
  if (!isAPIError(error)) return error;
  const code = (error.body as { code?: unknown } | undefined)?.code;
  if (code === "INVALID_PASSWORD") {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: WRONG_CURRENT_PASSWORD_MESSAGE,
    });
  }
  if (error.status === "UNAUTHORIZED") {
    // The session ended between the router's read and Better Auth's: the
    // same answer every procedure gives a session that has ended.
    return new TRPCError({
      code: "UNAUTHORIZED",
      message: "This session has ended",
    });
  }
  return error;
}
