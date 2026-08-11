import { TRPCError } from "@trpc/server";
import {
  InvalidInputError,
  NotFoundError,
  UpstreamError,
} from "@/server/services/errors";

/**
 * What a service said, in a code a client can act on — ISSUES.md DEBT-6.
 *
 * The mirror of `prisma-errors.ts`, and applied by the same middleware for the
 * same reason: on every procedure, because the alternative is remembering it
 * per resolver and the one that gets forgotten is the one that matters.
 *
 * The stakes are the same as the Prisma translator's. Phase 4's queue reads the
 * status to decide whether to retry, and `INTERNAL_SERVER_ERROR` means
 * transient — so a receipt that a service could not find was retried eight
 * times over rising backoff before being reported as exhausted, which is both
 * slower than it needs to be and a lie about what happened.
 */
export function translateServiceError(error: unknown): TRPCError | null {
  if (error instanceof NotFoundError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "That no longer exists",
      cause: error,
    });
  }

  if (error instanceof InvalidInputError) {
    // The caller can act on this — a re-upload, a different file — which is
    // what separates it from a server fault.
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "That cannot be processed",
      cause: error,
    });
  }

  if (error instanceof UpstreamError) {
    // Nothing here is broken, and the queue treats 5xx as worth retrying —
    // which for an outside system that is having a bad minute is right.
    return new TRPCError({
      code: "BAD_GATEWAY",
      message: "An outside service did not answer properly. Try again shortly.",
      cause: error,
    });
  }

  return null;
}
