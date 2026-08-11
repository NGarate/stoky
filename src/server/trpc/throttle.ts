import { TRPCError } from "@trpc/server";
import {
  RateLimitUnavailableError,
  consumeRateLimit,
  type RateLimit,
} from "@/lib/rate-limit";

/**
 * Rate limiting for a procedure that costs real work, rather than for a
 * procedure that is reachable without an account.
 *
 * OWASP ASVS **V11.1.4** asks for anti-automation controls on expensive
 * operations, not only on authentication. `src/lib/rate-limit.ts` was written
 * for the second case — sign-in and registration, counted per address — and
 * everything else in the application was unmetered. That is defensible for a
 * query that reads a row. It is not defensible for receipt upload, which
 * decodes up to 10 MB, re-encodes it through Sharp, writes it to a volume and
 * then starts Tesseract: one call is seconds of CPU and a file on disk, and
 * nothing stopped an account from making them in a loop.
 *
 * **Counted per account, not per address.** The caller here is already
 * authenticated, so the address adds nothing — an account is the thing that
 * can be held responsible, and a household behind one NAT would otherwise
 * share a budget for work each member does separately.
 *
 * **Fails closed**, the same way sign-in does and for the same reason: work
 * that cannot be counted is work that can be repeated without bound. The cost
 * is honest — with Valkey unreachable, receipts cannot be uploaded — and it is
 * the smaller half of a cost the application already pays, since nobody can
 * sign in either.
 */

/** Carried on the error so the HTTP layer can answer with `Retry-After`. */
export class ThrottledError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Rate limited; retry in ${retryAfterSeconds}s`);
    this.name = "ThrottledError";
  }
}

/**
 * Counts one call against `identifier`, and throws if the budget is spent.
 *
 * `TOO_MANY_REQUESTS` rather than `FORBIDDEN`, because the two mean opposite
 * things to Phase 4's write queue: a refusal it should stop retrying, against
 * a refusal it should retry later. Getting this wrong would make the queue
 * hammer a limit that exists to stop exactly that.
 */
export async function enforceRateLimit(
  limit: RateLimit,
  identifier: string,
  message: string,
): Promise<void> {
  let result;

  try {
    result = await consumeRateLimit(limit, identifier);
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) {
      console.error(
        "[trpc] refused: the rate limiter could not reach Valkey. Check VALKEY_URL and the cache service.",
        error.cause,
      );
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "The service is temporarily unavailable. Try again shortly.",
      });
    }
    throw error;
  }

  if (!result.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message,
      cause: new ThrottledError(result.retryAfterSeconds),
    });
  }
}
