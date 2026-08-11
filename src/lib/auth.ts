import NextAuth, { CredentialsSignin } from "next-auth";
import type { NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import * as argon2 from "argon2";
import type { HouseholdRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations/auth";
import { logSecurityEvent } from "@/lib/security-log";
import { assertUsableSecret } from "@/lib/auth/secret";
import {
  RateLimitUnavailableError,
  accountIdentifier,
  consumeRateLimit,
  loginAccountRateLimit,
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

/**
 * Checked here because this is the module every server path goes through, and
 * because it must happen before a session is ever signed. See
 * `@/lib/auth/secret` for what it refuses and why it is fatal.
 */
assertUsableSecret();

export const authConfig: NextAuthConfig = {
  /**
   * Trust the Host header, because a reverse proxy is the only thing in front
   * of this application.
   *
   * Auth.js v5 defaults this to false off Vercel, and then refuses any request
   * whose Host it cannot vouch for — `UntrustedHost`, a 500 from
   * `/api/auth/session`, and nobody can sign in. **Setting `NEXTAUTH_URL`
   * correctly does not help**, which is what makes this worth a comment:
   * verified against a production build with `NEXTAUTH_URL` matching the
   * server's own address exactly, and it still refused.
   *
   * So a deployed instance could not authenticate anybody at all, while
   * development and the browser suite — which run through `next dev`, where the
   * check does not apply — passed throughout.
   *
   * The trade is real and acceptable here: trusting the header means a forged
   * `Host` could steer a callback URL, and `docker-compose.prod.yml` puts
   * Traefik in front with a `Host(...)` rule, so nothing reaches this process
   * without matching the configured domain first. A deployment that exposes the
   * container directly does not have that protection.
   */
  trustHost: true,
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
            logSecurityEvent("auth.signin.throttled", {
              address: identifier,
              code: `retry-after=${retryAfterSeconds}`,
            });
            throw new RateLimitedSignin();
          }
        } catch (error) {
          if (error instanceof RateLimitUnavailableError) {
            // Fails closed. See `src/lib/rate-limit.ts` for why, and for what
            // it costs when Valkey is down.
            // Both: the structured line so the event is greppable alongside
            // the refusals, and the prose so an operator reading the container
            // output is told what to check rather than left with a code.
            logSecurityEvent("auth.unavailable", { address: identifier });
            console.error(
              "[auth] sign-in refused: the rate limiter could not reach Valkey. Check VALKEY_URL and the cache service.",
              error.cause,
            );
            throw new AuthUnavailableSignin();
          }
          throw error;
        }

        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          logSecurityEvent("auth.signin.failed", {
            address: identifier,
            code: "malformed",
          });
          return null;
        }

        /**
         * The second limit, and the one NIST SP 800-63B §5.2.2 actually asks
         * for: consecutive failed attempts *on a single account*.
         *
         * The per-IP limit above does not do that. An attacker with a hundred
         * addresses gets five attempts from each — five hundred against one
         * password. With both in force, a hundred addresses buy ten.
         *
         * Counted on the submitted address whether or not an account exists,
         * so a difference in behaviour cannot be used to learn which addresses
         * are registered. Counted before Argon2id, for the same reason as the
         * limit above.
         */
        const accountLimit = loginAccountRateLimit();
        const account = accountIdentifier(parsed.data.email);

        try {
          const { allowed, retryAfterSeconds } = await consumeRateLimit(
            accountLimit,
            account,
          );
          if (!allowed) {
            logSecurityEvent("auth.signin.throttled", {
              address: identifier,
              email: parsed.data.email,
              code: `account retry-after=${retryAfterSeconds}`,
            });
            throw new RateLimitedSignin();
          }
        } catch (error) {
          if (error instanceof RateLimitUnavailableError) {
            // Both: the structured line so the event is greppable alongside
            // the refusals, and the prose so an operator reading the container
            // output is told what to check rather than left with a code.
            logSecurityEvent("auth.unavailable", { address: identifier });
            console.error(
              "[auth] sign-in refused: the rate limiter could not reach Valkey. Check VALKEY_URL and the cache service.",
              error.cause,
            );
            throw new AuthUnavailableSignin();
          }
          throw error;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });

        // Both branches log the same event with the same fields. The
        // distinction between "no such account" and "wrong password" is
        // exactly what the flattened error message refuses to tell the
        // browser, and writing it into the log would put it back — the log is
        // readable by anyone who can read the container's output.
        if (!user) {
          logSecurityEvent("auth.signin.failed", {
            address: identifier,
            email: parsed.data.email,
          });
          return null;
        }

        const isValid = await argon2.verify(user.passwordHash, parsed.data.password);
        if (!isValid) {
          logSecurityEvent("auth.signin.failed", {
            address: identifier,
            email: parsed.data.email,
          });
          return null;
        }

        // Both counters, for the reason D30 gives: the specification counts
        // attempts rather than failures, and a household signing in from three
        // devices is three attempts before anybody has mistyped anything.
        await resetRateLimit(limit, identifier);
        await resetRateLimit(accountLimit, account);

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

    /**
     * Fifteen minutes of **inactivity**, not fifteen minutes of session.
     *
     * `maxAge` was a hard ceiling: a session died fifteen minutes after
     * sign-in whatever the person was doing, so a slow shop or a long receipt
     * review ended with a login form and a lost form. WCAG 2.1 **2.2.6
     * Timeouts** (AAA) asks that users be warned of an inactivity duration
     * that could cause data loss; nothing warned, and there was nothing to
     * warn about because activity did not help.
     *
     * `updateAge` makes it slide. Auth.js re-issues the token whenever the
     * session is read and the token is older than this, so any navigation or
     * any call to `/api/auth/session` pushes the expiry out. Five minutes is
     * the trade: often enough that an active person never notices, rarely
     * enough that reading the session is not a write on every request.
     *
     * The ceiling stays short on purpose. Phase 5 puts this application on a
     * kitchen tablet that lives in a kitchen, and Phase 7 §6 asks what a
     * stolen device can reach — a session that expires quickly once it is put
     * down is the answer, and sliding it on real activity is what makes that
     * bearable rather than hostile.
     */
    maxAge: 15 * 60,
    updateAge: 5 * 60,
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
