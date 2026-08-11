import { TRPCError } from "@trpc/server";
import { enforceRateLimit } from "../throttle";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import * as argon2 from "argon2";
import { registerSchema } from "@/lib/validations/auth";
import { rateLimitIdentifier, registerRateLimit } from "@/lib/rate-limit";

/**
 * Accounts, as far as tRPC is concerned.
 *
 * **Signing in is not here.** It is the credentials provider in
 * `src/lib/auth.ts`, and it used to be here too — an `auth.login` procedure on
 * the public router, unmetered and unused by the interface, which was a second
 * way to verify a password with none of the protections the real one has. It
 * was removed; `src/__tests__/utils/authorize.ts` drives the real path instead.
 *
 * So what is left is the parts Auth.js has no opinion about: creating an
 * account, reading the current one, and a `logout` that exists for shape.
 */
export const authRouter = createTRPCRouter({
  /**
   * Creates an account, and optionally the household to go with it.
   *
   * `publicProcedure`, necessarily — there is nobody to authenticate yet — which
   * makes it one of the two endpoints reachable from the internet by anyone.
   * That is why it is rate limited before it reads anything and why the
   * password has a maximum length: Argon2id here is 64 MB per call, so an
   * unbounded body would make this a memory amplifier (ISSUES.md CRITICAL-4,
   * DEBT-1).
   *
   * The household is optional. An account can exist without one, and
   * `householdRouter` is what such an account uses to get out of that state
   * (HOUSE-1).
   */
  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ ctx, input }) => {
      const { email, name, password, householdName } = input;

      // ISSUES.md CRITICAL-4. Counted before anything is created, and before
      // the ~250ms of Argon2id below, so the endpoint cannot be used to make
      // the server do that work on demand.
      //
      // A context with no headers is the integration suite calling the router
      // directly; there is no request to attribute an attempt to, and there is
      // also no way to reach this procedure from outside without one.
      if (ctx.headers) {
        // Through the shared helper rather than inline, so the refusal carries
        // its `ThrottledError` and the HTTP layer can answer with
        // `Retry-After`. It also fails closed here without this procedure
        // having to remember to — see `src/server/trpc/throttle.ts`.
        await enforceRateLimit(
          registerRateLimit(),
          rateLimitIdentifier(ctx.headers),
          "Too many registrations from this address. Try again in a little while.",
        );
      }

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Email already registered",
        });
      }

      // Hash password with Argon2id
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
      });

      // Create household if provided
      let householdId: string | undefined;
      if (householdName) {
        const household = await prisma.household.create({
          data: {
            name: householdName,
          },
        });
        householdId = household.id;
      }

      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          householdId,
          role: householdId ? "OWNER" : "MEMBER",
        },
      });

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      };
    }),

  /**
   * The signed-in account, read from the database rather than from the token.
   *
   * **Nothing calls it today**, which is worth knowing before relying on it.
   * The screens read what they need from the session, and the freshness
   * argument this would otherwise make — that a role change takes effect on the
   * next request rather than when the token is re-issued — is already handled
   * where it matters, in `householdProcedure`, which re-reads membership on
   * every request.
   *
   * Kept because it is the obvious shape of an endpoint a client will
   * eventually want, and because it costs one query. Throws UNAUTHORIZED rather
   * than returning null when the row is gone: a session for a deleted account
   * is not a missing resource, it is a session that should end.
   */
  me: protectedProcedure
    .query(async ({ ctx }) => {
      const userId = ctx.session.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          household: true,
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User not found",
        });
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        locale: user.locale,
        role: user.role,
        household: user.household,
      };
    }),

  /**
   * Does nothing, on purpose, and is not how anybody signs out.
   *
   * The session is a JWT with no server-side record, so there is nothing here
   * to invalidate. Ending a session is `signOutAction` in
   * `src/lib/auth/actions.ts` — a server action, so it can clear the cookie —
   * called by `SignOutButton`, which first purges the offline queue and tells
   * the service worker to forget the cached shell. Those two are the reason
   * signing out is a component's job rather than an endpoint's.
   *
   * This is kept so that a caller who goes looking for `auth.logout` finds this
   * paragraph instead of concluding that signing out is unimplemented, which is
   * what its previous silence invited.
   *
   * Either way a stolen token stays valid until it expires, which is what the
   * 15-minute `maxAge` in `src/lib/auth.ts` is for.
   */
  logout: protectedProcedure
    .mutation(async () => {
      return { success: true };
    }),
});
