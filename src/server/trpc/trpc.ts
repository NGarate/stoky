import { initTRPC, TRPCError } from "@trpc/server";
import { cache } from "react";
import superjson from "superjson";
import type { Session } from "next-auth";
import type { HouseholdRole, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { translatePrismaError, underlying } from "./prisma-errors";
import { translateServiceError } from "./service-errors";
import { logSecurityEvent } from "@/lib/security-log";
import { rateLimitIdentifier } from "@/lib/rate-limit";

export const createTRPCContext = cache(
  async (opts: {
    session: Session | null;
    headers?: Headers;
    db?: PrismaClient;
  }) => {
    return {
      session: opts.session,
      // Optional because the integration suite builds contexts directly, with
      // no HTTP request behind them. Only the public auth procedures read it,
      // and they say what they do when it is absent.
      headers: opts.headers ?? null,
      /**
       * The database, from the context rather than from a module import.
       *
       * Phase 4 wraps the writes a shop composes in one transaction each, so a
       * resolver has to be able to run against a transaction client instead of
       * the singleton. Reaching for the import inside a resolver is how a
       * write ends up *outside* the transaction that is supposed to contain
       * it — the worst failure mode of the replay design, and one no type can
       * catch. Taking it from the context makes that visible in the resolver's
       * own text.
       *
       * It also makes the transaction boundary testable: an integration test
       * can hand in a client whose second write throws and assert the first
       * one was rolled back, which is not otherwise expressible.
       */
      db: opts.db ?? prisma,
    };
  },
);

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;

/**
 * Turn a complaint from below the router into a code the caller can act on.
 *
 * On every procedure, because the alternative is remembering it per resolver
 * and the one that gets forgotten is the one that matters. A resolver's own
 * `TRPCError` passes through untouched: only errors Prisma or a service raised
 * and nobody caught are translated, and only the handful that mean something
 * specific — see `prisma-errors.ts` and `service-errors.ts`.
 *
 * It matters more than it did. Phase 4's queue reads the status to decide
 * whether to retry, so an uncaught `P2025` arriving as a 500 makes the queue
 * spend eight attempts on a row that no longer exists.
 */
const domainErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = underlying(result.error);
    // Both translators, one unwrap. A service error and a Prisma error are the
    // same shape of problem — something below the router knows what went wrong
    // and the transport does not — and they are disjoint, so the order between
    // them does not matter.
    const translated = translatePrismaError(cause) ?? translateServiceError(cause);
    if (translated) throw translated;
  }
  return result;
});

/**
 * Write a line whenever a request is refused for a security reason — ASVS
 * V7.1.3.
 *
 * **On every procedure, for the same reason `domainErrors` is.** An
 * access-control failure is thrown from three middlewares and from a dozen
 * resolvers checking `householdId`, and the one that gets forgotten is the one
 * that matters: a resolver reaching another household's row is exactly the
 * event an owner would want to have been recorded. Catching the refusal
 * centrally means a new router cannot forget to be audited.
 *
 * Only the three codes that mean *refused*. Logging every error would bury
 * them in NOT_FOUNDs and turn the log into something nobody greps.
 */
const securityEvents = t.middleware(async ({ ctx, next, path }) => {
  const result = await next();

  if (!result.ok) {
    const code = result.error.code;

    if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
      logSecurityEvent("access.denied", {
        path,
        code,
        userId: ctx.session?.user?.id,
        address: ctx.headers ? rateLimitIdentifier(ctx.headers) : undefined,
      });
    } else if (code === "TOO_MANY_REQUESTS") {
      logSecurityEvent("request.throttled", {
        path,
        userId: ctx.session?.user?.id,
        address: ctx.headers ? rateLimitIdentifier(ctx.headers) : undefined,
      });
    }
  }

  return result;
});

// Outside `domainErrors`, so what gets logged is the code the caller actually
// received rather than the one the resolver happened to throw first.
export const publicProcedure = t.procedure.use(securityEvents).use(domainErrors);

/**
 * The capability matrix of `docs/REDESIGN_PLAN.md` §5.2, as roles.
 *
 * The matrix has three columns — Admin, User, Kitchen — and OWNER and ADMIN
 * share the first. It collapses to three tiers because every row in it is one
 * of three questions: may this account look, may it change household data, may
 * it change the household itself.
 *
 * `read` is every role: a kitchen tablet exists to be looked at. Consuming
 * stock is deliberately a `read`-tier capability rather than a `write` one —
 * it is the one write a kitchen account has, and the matrix says so.
 */
export const CAPABILITY_ROLES: Record<
  "read" | "write" | "admin",
  readonly HouseholdRole[]
> = {
  read: ["OWNER", "ADMIN", "MEMBER", "KITCHEN"],
  write: ["OWNER", "ADMIN", "MEMBER"],
  admin: ["OWNER", "ADMIN"],
};

/**
 * Authenticated, and nothing more. Use it only where the household is
 * irrelevant — `auth.me` and `auth.logout`. Everything that touches household
 * data wants `householdProcedure` or one of its narrower forms.
 */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Not signed in",
    });
  }
  return next({
    ctx: {
      session: ctx.session,
    },
  });
});

/**
 * Authenticated, in a household, and carrying that household's role.
 *
 * **Membership and role are read from the database, not from the session.**
 * The JWT carries both so the interface can hide what an account cannot do,
 * but the interface is not the control: hiding a button is not a restriction
 * (`REDESIGN_PLAN.md` §5.2). Reading them here has two consequences worth
 * having:
 *
 * - a role change or a removal takes effect on the next request, rather than
 *   whenever the 15-minute token happens to expire;
 * - an account that has just created its household can use it immediately,
 *   without signing out and in again to mint a token that knows about it.
 *
 * The cost is one primary-key lookup per call, and in four of the eight
 * routers it is not even that — those procedures were already making exactly
 * this query, one copy per procedure, to find the household id.
 */
export const householdProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const membership = await ctx.db.user.findUnique({
    where: { id: ctx.session.user.id },
    select: { householdId: true, role: true },
  });

  if (!membership) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "This account no longer exists",
    });
  }

  if (!membership.householdId) {
    // PRECONDITION_FAILED rather than FORBIDDEN: nothing is wrong with the
    // account, it is missing a household, and that is a state the client can
    // resolve by creating one. See ISSUES.md HOUSE-1.
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This account does not belong to a household yet",
    });
  }

  return next({
    ctx: {
      session: ctx.session,
      householdId: membership.householdId,
      role: membership.role,
    },
  });
});

/**
 * Household data: stock, products, lists, receipts, prices. Every role except
 * KITCHEN, which may look and consume and nothing else.
 */
export const writeProcedure = householdProcedure.use(({ ctx, next }) => {
  if (!CAPABILITY_ROLES.write.includes(ctx.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `A ${ctx.role} account may not change household data`,
    });
  }
  return next();
});

/**
 * The household itself: its people, its stores, its locations, its settings.
 * OWNER and ADMIN only.
 */
export const adminProcedure = householdProcedure.use(({ ctx, next }) => {
  if (!CAPABILITY_ROLES.admin.includes(ctx.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `A ${ctx.role} account may not change the household`,
    });
  }
  return next();
});
