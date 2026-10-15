import { cache } from "react";
import { headers } from "next/headers";
import { connection } from "next/server";
import type { HouseholdRole } from "@prisma/client";
import { assertUsableSecret } from "@/lib/auth/secret";
import { getAuth } from "@/lib/auth/instance";
import type { AppSession } from "@/lib/auth/session";
import { BROWSER_CAP_S, deadlineKind } from "@/lib/auth/session-policy";

/**
 * Checked here because this is the module every server path goes through, and
 * because it must happen before a session is ever signed. See
 * `@/lib/auth/secret` for what it refuses and why it is fatal.
 */
assertUsableSecret();

/**
 * Better Auth's session, as the application reads it (`AppSession`).
 *
 * The parts of `getSession`'s answer this maps; written out rather than taken
 * from Better Auth's inferred type so this file says what it relies on.
 */
interface LibrarySession {
  session: {
    id: string;
    expiresAt: Date | string;
    authenticatedAt?: Date | string | null;
  };
  user: {
    id: string;
    email: string;
    name: string;
    householdId?: string | null;
    role?: string | null;
  };
}

/**
 * Copied field by field rather than cast, so the type the rest of the code
 * base reads is what this returns and not a claim about it.
 *
 * `householdId` is absent, never null, for an account with no household. A
 * row with no role is read as `KITCHEN`, the least-privileged one, so a
 * session can never outrank its account; `User.role` has a default, so no row
 * should lack one. The role is not an authority either way:
 * `householdProcedure` reads it from the database on every call.
 *
 * A row without `authenticatedAt` — the column has a default, so none should
 * lack it — reads as an idle deadline: the warning then offers the button,
 * and pressing it asks `auth.session`, which answers from the row.
 */
export function toAppSession(result: LibrarySession): AppSession {
  const { session, user } = result;
  const expiresAt = new Date(session.expiresAt);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      householdId: user.householdId ?? undefined,
      role: (user.role as HouseholdRole | null | undefined) ?? "KITCHEN",
    },
    expires: expiresAt.toISOString(),
    expiresKind: session.authenticatedAt
      ? deadlineKind({
          expiresAt,
          authenticatedAt: new Date(session.authenticatedAt),
          capS: BROWSER_CAP_S,
        })
      : "idle",
    sessionId: session.id,
  };
}

/**
 * The session these request headers carry, or null — from the row, every
 * time (the cookie cache is off, `src/lib/auth/instance.ts`), so a deleted or
 * expired row is refused here and Better Auth deletes an expired one.
 *
 * Request-free on purpose: it takes the headers rather than reading them, so
 * a test can drive it with a cookie and the tRPC route with its own request.
 *
 * `refresh` lets Better Auth run its daily refresh of a remembered session.
 * Every session today is a browser session, which Better Auth never refreshes
 * and whose expiry nothing but `auth.session` moves, so it changes nothing
 * yet; the tRPC route asks for it and a page render does not, so a render
 * never writes.
 */
export async function readSession(
  requestHeaders: Headers,
  { refresh }: { refresh: boolean },
): Promise<AppSession | null> {
  const result = await getAuth().api.getSession({
    headers: requestHeaders,
    query: { disableRefresh: !refresh },
  });
  return result ? toAppSession(result as unknown as LibrarySession) : null;
}

/**
 * The session of the request being rendered — and the reason it starts with
 * `await connection()`.
 *
 * **Reading the session is request data, so a caller of this can never
 * prerender.** Cache Components requires that to be *declared*, and until it
 * is, Next starts a prerender, reaches request data inside the library, and
 * aborts by throwing. Node consumed that rejection silently; Bun — the
 * runtime since `b81102d` — reports it, once per request per route, 1612
 * across a suite run (`ISSUES.md` RUNTIME-1). Nothing was ever wrong with the
 * responses. The cost was the log: this project has no error tracking, so the
 * log is what it has, and spurious rejections at that volume bury a real one.
 *
 * `await connection()` is Next's own answer, and it belongs **here** rather
 * than at the call sites. Fixing them one at a time was tried first and is how
 * the diagnosis went wrong twice: the error names only the first site that
 * trips it, so each fix reveals the next and reads as no progress at all.
 *
 * It costs no prerendering: the root layout is already request-bound by the
 * CSP nonce.
 *
 * Wrapped in React's `cache`, so the layout, the locale and the page asking in
 * one render cost one session read, not three.
 */
export const auth = cache(async (): Promise<AppSession | null> => {
  await connection();
  return readSession(await headers(), { refresh: false });
});
