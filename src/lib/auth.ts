import NextAuth, { CredentialsSignin } from "next-auth";
import type { NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import * as argon2 from "argon2";
import type { HouseholdRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations/auth";
import {
  RateLimitUnavailableError,
  consumeRateLimit,
  loginRateLimit,
  rateLimitIdentifier,
  resetRateLimit,
} from "@/lib/rate-limit";

/**
 * Sign-in refused because the address has run out of attempts.
 *
 * A `CredentialsSignin` subclass rather than a bare throw because its `code`
 * is the one thing Auth.js passes back to the browser — everything else is
 * deliberately flattened to "CredentialsSignin" so a login form cannot leak
 * whether it was the address or the password that was wrong. The client turns
 * this code into a message that says to wait, which matters: a correct
 * password rejected with "invalid credentials" reads as a broken account.
 */
export class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

/** Sign-in refused because the rate limiter could not reach Valkey. */
export class AuthUnavailableSignin extends CredentialsSignin {
  code = "auth_unavailable";
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const limit = loginRateLimit();
        const identifier = rateLimitIdentifier(request.headers);

        // Counted before the credentials are looked at, not after. A limit
        // that only counts attempts it has already spent ~250ms of Argon2id
        // on is also a way to make the server do that work on demand.
        try {
          const { allowed, retryAfterSeconds } = await consumeRateLimit(limit, identifier);
          if (!allowed) {
            console.warn(
              `[auth] sign-in refused: rate limit reached for ${identifier}, ${retryAfterSeconds}s remaining`,
            );
            throw new RateLimitedSignin();
          }
        } catch (error) {
          if (error instanceof RateLimitUnavailableError) {
            // Fails closed. See `src/lib/rate-limit.ts` for why, and for what
            // it costs when Valkey is down.
            console.error(
              "[auth] sign-in refused: the rate limiter could not reach Valkey. Check VALKEY_URL and the cache service.",
              error.cause,
            );
            throw new AuthUnavailableSignin();
          }
          throw error;
        }

        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });

        if (!user) return null;

        const isValid = await argon2.verify(user.passwordHash, parsed.data.password);
        if (!isValid) return null;

        await resetRateLimit(limit, identifier);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          householdId: user.householdId ?? undefined,
          role: user.role,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 15 * 60, // 15 minutes
  },
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.householdId = user.householdId;
        token.role = user.role;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (token) {
        session.user.id = token.sub as string;
        session.user.householdId = token.householdId as string | undefined;
        // A token minted before roles existed carries none. Falling back to
        // the least-privileged role rather than to MEMBER means an old
        // session cannot outrank a new one; it expires within 15 minutes.
        session.user.role = (token.role as HouseholdRole | undefined) ?? "KITCHEN";
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
