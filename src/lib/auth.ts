import NextAuth, { CredentialsSignin } from "next-auth";
import { connection } from "next/server";
import type { NextAuthConfig, Session } from "next-auth";
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

  /**
   * **There is deliberately no `adapter`.**
   *
   * There was one — `PrismaAdapter(prisma)` — and it did nothing.
   * `@auth/core`'s credentials branch mints and encodes a JWT unconditionally
   * and never calls an adapter, so no session was ever persisted through it.
   *
   * Removing it was not tidying. `@auth/core/lib/init.js` reads
   * `strategy: config.adapter ? "database" : "jwt"`: **an adapter's presence
   * picks the default strategy**, and this schema has no `Session`, `Account`
   * or `VerificationToken` model. So `session.strategy: "jwt"` below was the
   * only thing overriding a default the configuration could not survive, while
   * reading like a restatement of one. Deleting that line — plausible
   * tidy-up — left sign-in answering 302 and setting a cookie while every
   * session read failed with `prisma.session.findUnique is undefined` and
   * `/api/auth/session` returned `null`. Measured, 2026-08-27, ISSUES.md
   * AUTH-1.
   *
   * With no adapter, `"jwt"` is the default rather than an override, and the
   * trap is gone rather than commented.
   *
   * **Adding an adapter back is a schema change, not a config change.** It
   * would need those three models, and it buys nothing while sign-in is
   * credentials-only, because credentials can never use a database session. An
   * OAuth provider is the case that would want one, and it can bring them.
   */
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

const { handlers, auth: readSession, signIn, signOut } = NextAuth(authConfig);

export { handlers, signIn, signOut };

/**
 * The session — and the reason this wraps NextAuth's own `auth` rather than
 * re-exporting it.
 *
 * **Reading the session is request data, so a caller of this can never
 * prerender.** Cache Components requires that to be *declared*, and until it
 * is, Next starts a prerender, reaches `crypto.getRandomValues()` inside
 * NextAuth, and aborts by throwing. Node consumed that rejection silently;
 * Bun — the runtime since `b81102d` — reports it, once per request per route,
 * 1612 across a suite run (`ISSUES.md` RUNTIME-1). Nothing was ever wrong with
 * the responses. The cost was the log: this project has no error tracking, so
 * the log is what it has, and spurious rejections at that volume bury a real
 * one.
 *
 * `await connection()` is Next's own answer, and it belongs **here** rather
 * than at the nine call sites. Fixing them one at a time was tried first and
 * is how the diagnosis went wrong twice: the error names only the first site
 * that trips it, so each fix reveals the next and reads as no progress at all.
 * It also leaves the next `await auth()` somebody writes free to reintroduce
 * the defect in silence.
 *
 * It costs no prerendering. Measured either side of the change: the same eight
 * routes are Partial Prerender, because the root layout is already
 * request-bound by the CSP nonce and nothing above these callers was
 * prerendering to begin with.
 *
 * The wrapper is deliberately zero-argument, and its return type is written
 * out rather than inferred. NextAuth's `auth` is four overloads — a route
 * wrapper, a `(req, res)` handler, a middleware — and `ReturnType` picks the
 * middleware, which typechecks here and turns `session.user` into an error at
 * all nine call sites. Nothing has ever used those shapes; a narrower export
 * is one fewer to keep dynamic-safe.
 */
export async function auth(): Promise<Session | null> {
  await connection();
  return readSession();
}
