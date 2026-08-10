import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
import * as argon2 from "argon2";
import { registerSchema } from "@/lib/validations/auth";
import {
  RateLimitUnavailableError,
  consumeRateLimit,
  rateLimitIdentifier,
  registerRateLimit,
} from "@/lib/rate-limit";

export const authRouter = createTRPCRouter({
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
        const limit = registerRateLimit();
        const identifier = rateLimitIdentifier(ctx.headers);
        try {
          const { allowed, retryAfterSeconds } = await consumeRateLimit(limit, identifier);
          if (!allowed) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: `Too many registrations from this address. Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`,
            });
          }
        } catch (error) {
          if (error instanceof RateLimitUnavailableError) {
            // Fails closed, like sign-in. See `src/lib/rate-limit.ts`.
            console.error(
              "[auth] registration refused: the rate limiter could not reach Valkey. Check VALKEY_URL and the cache service.",
              error.cause,
            );
            throw new TRPCError({
              code: "SERVICE_UNAVAILABLE",
              message: "Registration is temporarily unavailable",
            });
          }
          throw error;
        }
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

  logout: protectedProcedure
    .mutation(async () => {
      return { success: true };
    }),
});
