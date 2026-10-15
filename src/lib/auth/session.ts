import type { HouseholdRole } from "@prisma/client";

/**
 * The session as the application reads it — owned here, not by the library
 * that signs it.
 *
 * Twenty files used to import `Session` from `next-auth`: the tRPC context,
 * the HTTP handler and every integration test that builds a context. Each of
 * them would have had to change in the commit that replaces the library, and
 * none of them cares which library it is. They read this type instead, and
 * `auth()` in `src/lib/auth.ts` is the one place that turns what the library
 * hands back into it.
 *
 * The shape is the one the `session` callback in `src/lib/auth.ts` produces,
 * with `src/types/next-auth.d.ts`'s augmentation applied: `householdId` is
 * absent for an account with no household, never `null`, and `role` is always
 * present. `email` and `name` are required because the `authorize` result
 * always carries both (`User.email` and `User.name` are non-null columns).
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
}
