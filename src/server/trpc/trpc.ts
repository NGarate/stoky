import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "@/lib/superjson";
import type { AppSession } from "@/lib/auth/session";
import type { HouseholdRole, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { translatePrismaError, underlying } from "./prisma-errors";
import { translateServiceError } from "./service-errors";
import { logSecurityEvent } from "@/lib/security-log";
import { describeError } from "@/server/log-error";
import { clientAddress } from "@/lib/rate-limit";

export async function createTRPCContext(opts: {
  session: AppSession | null;
  headers?: Headers;
  db?: PrismaClient;
}) {
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
}

/**
 * What the client is told when the server fails in a way nobody anticipated.
 *
 * A transport string, like the others in `prisma-errors.ts`: the screens map
 * messages to their own translated keys and fall back to a generic one, so
 * nothing ever shows this text to a person directly.
 */
export const INTERNAL_ERROR_MESSAGE = "Something went wrong on the server.";

/**
 * Keep a server fault's details on the server.
 *
 * Every error nobody translated reaches the client as `INTERNAL_SERVER_ERROR`,
 * and tRPC's default shape carries **the underlying error's own message** —
 * a Prisma raw-query failure with its SQL, a file path, a library's internals,
 * sent verbatim to any signed-in browser, in production as in development.
 * That is OWASP ASVS V7.4.1, and a map of the server for anyone probing it.
 *
 * Only that code is rewritten. Everything else is a refusal or a domain
 * outcome a resolver, `domainErrors` or a middleware chose to send, worded
 * for the client, and the screens read those messages ("product not found",
 * "household") to pick what to say.
 *
 * The original goes to the server log instead. Until this there was no
 * `onError` on the route either, so an unexpected failure was not written
 * anywhere at all — the only copy of it was the one sent to the browser.
 * A Prisma error goes there through `describeError`, because its message is
 * the call with its arguments: a write that fails validation would otherwise
 * print the email and password hash it was writing.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error, path }) => {
    if (error.code !== "INTERNAL_SERVER_ERROR") return shape;

    console.error(
      `[trpc] ${path ?? "(no path)"} failed`,
      describeError(error.cause ?? error),
    );
    return { ...shape, message: INTERNAL_ERROR_MESSAGE };
  },
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
    const translated =
      translatePrismaError(cause) ?? translateServiceError(cause);
    if (translated) throw translated;
  }
  return result;
});

/**
 * The requests with nobody signed in that have already written a refusal.
 *
 * Keyed on the context, which tRPC builds once per HTTP request and hands to
 * every call in a batch; a `WeakSet`, so a finished request's entry goes with
 * it.
 */
const anonymousRefusalRecorded = new WeakSet<object>();

/**
 * Whether this refusal is written to the security log: always for a signed-in
 * caller, and **once per request for a caller with nobody signed in**.
 *
 * Without the bound, one anonymous GET of `MAX_TRPC_BATCH_SIZE` protected
 * calls — 1.8 KB of URL — wrote a hundred `access.denied` lines, 13 KB, and
 * the bundle keeps 50 MB of app log, so a few thousand requests rotated a
 * brute-force run's `auth.signin.failed` lines out of reach (final review of
 * the 2026-10-12 security work). The first refusal says that the request
 * happened, from where and for what; the other ninety-nine said the same
 * thing again. A signed-in caller's refusals are each kept: they name an
 * account, which is accountable, and each one can be a different row of
 * somebody else's household.
 */
function mayRecordRefusal(ctx: { session: AppSession | null }): boolean {
  if (ctx.session?.user?.id) return true;
  if (anonymousRefusalRecorded.has(ctx)) return false;
  anonymousRefusalRecorded.add(ctx);
  return true;
}

/**
 * Write a line whenever a request is refused for a security reason — ASVS
 * V7.1.3.
 *
 * **On every procedure, for the same reason `domainErrors` is.** An
 * access-control failure is thrown from three middlewares and from two
 * resolver checks (`assertMayActOnOwner`, the replay envelope's composer
 * check), and the one that gets forgotten is the one that matters. Catching
 * the refusal centrally means a new router cannot forget to be audited.
 *
 * Only the three codes that mean *refused*. A resolver reaching for another
 * household's row is refused with NOT_FOUND, not FORBIDDEN, so the answer does
 * not confirm the id exists; that miss is recorded by `householdProcedure`
 * below, which is the only place that knows the request was household-scoped.
 * Logging every NOT_FOUND here would add the public and account-only
 * procedures' misses, which say nothing about anybody's household.
 */
const securityEvents = t.middleware(async ({ ctx, next, path }) => {
  const result = await next();

  if (!result.ok) {
    const code = result.error.code;
    const event =
      code === "UNAUTHORIZED" || code === "FORBIDDEN"
        ? "access.denied"
        : code === "TOO_MANY_REQUESTS"
          ? "request.throttled"
          : null;

    if (event && mayRecordRefusal(ctx)) {
      logSecurityEvent(event, {
        path,
        // A throttled call's code is the event itself; a denial's says which.
        code: event === "access.denied" ? code : undefined,
        userId: ctx.session?.user?.id,
        address: ctx.headers ? clientAddress(ctx.headers) : undefined,
      });
    }
  }

  return result;
});

// Outside `domainErrors`, so what gets logged is the code the caller actually
// received rather than the one the resolver happened to throw first.
export const publicProcedure = t.procedure
  .use(securityEvents)
  .use(domainErrors);

/**
 * The cause a resolver attaches to a NOT_FOUND that is not a household row
 * being looked up — `product.resolveScan`'s "nobody knows this barcode", which
 * is a fact about Open Food Facts. Without it the household miss log below
 * would record every unknown barcode a kitchen scans offline as a refusal.
 */
export class NotHouseholdData extends Error {
  constructor(message = "Not household data") {
    super(message);
    this.name = "NotHouseholdData";
  }
}

/**
 * Whether the caller is about to receive a NOT_FOUND about household data.
 *
 * Judged on the code the caller will *receive*, not the one thrown. A scoped
 * write — `store.update`, `shopping.removeItem`, anything with `householdId`
 * in an `update`/`delete` where — refuses another household's id as Prisma's
 * `P2025`, and `domainErrors`, which runs outside this middleware, has not
 * translated it yet. Reading only the resolver's own `TRPCError` would leave
 * those procedures a way to probe that writes nothing. The cost is that a row
 * deleted between a check and a write is recorded too; it is a miss like any
 * other, and the line already cannot tell a miss from a probe.
 */
function isHouseholdMiss(error: TRPCError): boolean {
  if (error.cause instanceof NotHouseholdData) return false;
  const cause = underlying(error);
  const received =
    translatePrismaError(cause) ?? translateServiceError(cause) ?? error;
  return received.code === "NOT_FOUND";
}

/**
 * The capability matrix of `docs/REDESIGN_PLAN.md` §5.2, as roles.
 *
 * The matrix has three columns — Admin, User, Kitchen — and OWNER and ADMIN
 * share the first. It collapses to three tiers because every row in it is one
 * of three questions: may this account look, may it change household data, may
 * it change the household itself.
 *
 * `read` is every role: a kitchen tablet exists to be looked at. Consuming
 * stock, starting a shopping list and adding an item to one are deliberately
 * `read`-tier capabilities rather than `write` ones — they are the writes a
 * kitchen account has (the last two since the owner's pass, §5.2 amendment,
 * D88), and the matrix says so.
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
 * The session carries both so the interface can hide what an account cannot do,
 * but the interface is not the control: hiding a button is not a restriction
 * (`REDESIGN_PLAN.md` §5.2). Reading them here has two consequences worth
 * having:
 *
 * - a role change or a removal takes effect on the next request, whatever the
 *   session was read as;
 * - an account that has just created its household can use it immediately,
 *   without signing out and in again.
 *
 * The cost is one primary-key lookup per call, and in four of the eight
 * routers it is not even that — those procedures were already making exactly
 * this query, one copy per procedure, to find the household id.
 *
 * **A NOT_FOUND from inside a household is written to the security log**, as
 * `access.denied` with `reason: "not-found"` (ASVS V7.2.2). A resolver's
 * lookups are scoped to `householdId`, and the refusal of another household's
 * id is deliberately the same NOT_FOUND as an id nobody has, so the browser
 * learns nothing. The cost of that uniformity is that the server cannot tell
 * the two apart either without a second, unscoped read at each of the
 * forty-odd places a router throws it — so it records both, here, where no
 * router can forget to. A row deleted on another device shows up too; a
 * burst of them from one account is what an operator is looking for.
 *
 * The line names the account, its household and the procedure, **never the id
 * that was asked for**: the id is the prober's input, and a log that quotes
 * input is a second copy of whatever the input was.
 *
 * That includes the NOT_FOUND `domainErrors` makes of a Prisma `P2025` on the
 * way out, because a write scoped by `householdId` refuses a foreign id that
 * way (`isHouseholdMiss`). The one NOT_FOUND left out is a resolver's answer
 * about the world rather than about a row, which it marks `NotHouseholdData`.
 */
export const householdProcedure = protectedProcedure
  .use(async ({ ctx, next }) => {
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
  })
  .use(async ({ ctx, next, path }) => {
    const result = await next();

    if (!result.ok && isHouseholdMiss(result.error)) {
      logSecurityEvent("access.denied", {
        path,
        code: "NOT_FOUND",
        reason: "not-found",
        userId: ctx.session.user.id,
        householdId: ctx.householdId,
        address: ctx.headers ? clientAddress(ctx.headers) : undefined,
      });
    }

    return result;
  });

/**
 * Household data: stock, products, lists, receipts, prices. Every role except
 * KITCHEN, whose writes are the `read`-tier ones above: consuming stock,
 * starting a shopping list and adding to one (D88).
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
