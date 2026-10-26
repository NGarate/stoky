import { Prisma } from "@/generated/prisma/client";
import { TRPCError } from "@trpc/server";

/**
 * What the database said, in a code a client can act on.
 *
 * Every router already throws `TRPCError` for the refusals it decides itself
 * (`ISSUES.md` DEBT-4). What it does not decide is a row that vanished between
 * the check and the write, and Prisma reports that as `P2025` — which arrives
 * at the client as `INTERNAL_SERVER_ERROR`, indistinguishable from the server
 * falling over.
 *
 * That was cosmetic until Phase 4. Now the offline queue reads the status to
 * decide what to do next, and a 500 means "transient": a tick-off whose row
 * somebody else deleted is retried eight times, over rising backoff, before
 * being reported as exhausted — and reported wrongly, since it was never going
 * to work. `NOT_FOUND` ends it on the first attempt with the right words.
 *
 * The classification table in `src/lib/offline/classify.ts` is only *true* if
 * this exists. That is the whole reason it does.
 */

/** Prisma codes worth translating. Anything else stays a server fault. */
export function translatePrismaError(error: unknown): TRPCError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;

  switch (error.code) {
    // "An operation failed because it depends on one or more records that
    // were required but not found." A row deleted since it was read.
    case "P2025":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "That no longer exists",
        cause: error,
      });

    // Unique constraint. Two people did the same thing at once, or a
    // pre-check lost a race with itself.
    case "P2002":
      return new TRPCError({
        code: "CONFLICT",
        message: "That already exists",
        cause: error,
      });

    // Foreign key constraint: a reference to something that is not there.
    // The request is wrong rather than the timing.
    case "P2003":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "That refers to something that does not exist",
        cause: error,
      });

    // Pool exhausted, transaction timed out, write conflict. Honestly "try
    // again", which is what 408 means — and what the queue does with it.
    case "P2024":
    case "P2028":
    case "P2034":
      return new TRPCError({
        code: "TIMEOUT",
        message: "The server was busy. Nothing was lost.",
        cause: error,
      });

    default:
      return null;
  }
}

/**
 * Pull the original error out of whatever tRPC wrapped it in.
 *
 * A resolver's throw arrives here already wrapped in a `TRPCError` with code
 * `INTERNAL_SERVER_ERROR` and the real error on `cause`. Unwrapping one level
 * is enough — nothing in this codebase nests deeper — and doing it explicitly
 * beats a recursive walk that could loop on a self-referential cause.
 */
export function underlying(error: unknown): unknown {
  if (error instanceof TRPCError && error.cause !== undefined) {
    return error.cause;
  }
  return error;
}
