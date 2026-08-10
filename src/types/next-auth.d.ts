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
  }
}
