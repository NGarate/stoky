import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    householdId?: string;
  }

  interface Session {
    user: User & {
      id: string;
      householdId?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    householdId?: string;
  }
}
