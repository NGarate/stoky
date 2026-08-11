/**
 * What a service can fail with — ISSUES.md DEBT-6.
 *
 * The routers stopped throwing bare `Error` in Phase 3 (DEBT-4). The services
 * beneath them did not, so `ocr`, `productMatcher` and `receiptParser` each
 * threw `new Error("Receipt not found")`, and a procedure that called one still
 * handed the client `INTERNAL_SERVER_ERROR` — the same defect, one layer down.
 *
 * **Domain errors and a translator at the boundary, not `TRPCError` here.** The
 * shorter fix is to import `TRPCError` into the services and be done. Two
 * things argue against it:
 *
 * - `processReceiptOcr` is called from `processReceiptAsync`, which runs *after*
 *   the request that started it has returned. There is no client to give a
 *   status code to, and a transport error thrown into a background task is a
 *   category mistake that reads as though someone is waiting.
 * - `src/server/trpc/prisma-errors.ts` already establishes the shape for this
 *   codebase: the layer that fails says *what* went wrong, and one translator
 *   at the tRPC boundary decides what that means over HTTP.
 *
 * The kinds are deliberately few. A service either could not find something,
 * was given something it cannot work with, or was let down by an outside
 * system; anything beyond that is a bug and should stay a 500.
 */

/** Base for everything a service raises on purpose. */
export abstract class ServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * The row is not there.
 *
 * Translated to `NOT_FOUND`, which matters beyond tidiness: the offline queue
 * classifies 5xx as transient and retries it eight times over rising backoff.
 * A receipt that does not exist is never going to exist, and reporting it as
 * "exhausted" after eight attempts is both slower and wrong.
 */
export class NotFoundError extends ServiceError {}

/**
 * The input reached the service and cannot be worked with — an empty image
 * file, a receipt with no OCR text yet.
 *
 * Distinct from `NotFoundError` because the caller can do something about it,
 * and distinct from a Zod failure because it is only knowable after a read.
 */
export class InvalidInputError extends ServiceError {}

/**
 * An outside system failed: Open Food Facts returned a status we cannot use.
 *
 * `BAD_GATEWAY` rather than `INTERNAL_SERVER_ERROR`, because nothing here is
 * broken and the honest answer to the person waiting is "not us, try later".
 */
export class UpstreamError extends ServiceError {
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
