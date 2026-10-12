import "next-auth";
import "next-auth/jwt";
import type { HouseholdRole } from "@prisma/client";

declare module "next-auth" {
  interface User {
    householdId?: string;
    role?: HouseholdRole;
  }

  interface Session {
    user: User & {
      id: string;
      householdId?: string;
      role: HouseholdRole;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    householdId?: string;
    role?: HouseholdRole;
    /**
     * When the password was typed, in seconds since the epoch. Stamped once at
     * sign-in and never moved, unlike `iat`, which every re-issue resets; the
     * `jwt` callback in `src/lib/auth.ts` refuses a token whose `authTime` is
     * older than `MAX_SESSION_AGE_S`, or that has none.
     */
    authTime?: number;
  }
}
