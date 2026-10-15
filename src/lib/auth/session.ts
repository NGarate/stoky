import type { HouseholdRole } from "@prisma/client";

/**
 * The session as the application reads it — owned here, not by the library
 * that signs it.
 *
 * Twenty files used to import `Session` from `next-auth`: the tRPC context,
 * the HTTP handler and every integration test that builds a context. When the
 * library was replaced (PROGRESS D135) none of them changed, because none of
 * them cares which library it is. `toAppSession` in `src/lib/auth.ts` is the
 * one place that turns what the library hands back into this.
 *
 * `householdId` is absent for an account with no household, never `null`, and
 * `role` is always present. `email` and `name` are required because
 * `User.email` and `User.name` are non-null columns.
 *
 * The role here is what the account held when the session was read, not an
 * authority: `householdProcedure` reads membership and role from the database
 * on every call (`src/server/trpc/trpc.ts`).
 */
export interface AppSessionUser {
  id: string;
  email: string;
  name: string;
  householdId?: string;
  role: HouseholdRole;
}

export interface AppSession {
  user: AppSessionUser;
  /** When the session lapses, as an ISO 8601 string. */
  expires: string;
  /**
   * The `Session` row this is. Required, because a procedure that ends or
   * keeps "this session" filters on it, and Prisma reads `{ id: undefined }`
   * as no condition at all.
   */
  sessionId: string;
}
