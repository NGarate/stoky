import { TRPCClientError } from "@trpc/client";

/**
 * What to do with a queued change the server did not accept.
 *
 * The queue has to tell three things apart, and getting any of them wrong
 * loses somebody's shopping:
 *
 * - **transient** — the server never gave an answer, or gave one that means
 *   "later". Keep it and try again.
 * - **auth** — the session ended. Keep *everything*, stop sending, and ask for
 *   a sign-in. This is the likeliest outcome of a real shop and it must never
 *   discard: the JWT lasts fifteen minutes, slides only on activity, and a
 *   phone in aeroplane mode makes no requests. Reconnect after a twenty-minute
 *   shop is a 401 by construction.
 * - **permanent** — the server decided, and the answer will not change. Do not
 *   retry; say so, by name.
 * - **reconcile** — a special case of permanent that is not a failure at all.
 *   See below.
 * - **review** — a queued scan of a barcode nobody knows yet (T7). Also not a
 *   failure: the person scanned something real, and only they can name it. The
 *   sync indicator asks the question and a form opens prefilled with the
 *   barcode, the same shape as reconcile — allow the intent, ask the human.
 *
 * **Reconcile is the one worth reading.** Stock has a floor: two people who
 * each use the last unit cannot both be right, so the second to reach the
 * server is refused. Reporting that as "it did not save" throws away a real
 * event — they *did* take the milk. It is instead the question only a person
 * can answer: the count and the house disagree, and someone has to look at the
 * shelf. `REDESIGN_PLAN.md` §5.5.3 — allow and reconcile, never discard.
 */
export type MutationOutcome =
  | "transient"
  | "auth"
  | "permanent"
  | "reconcile"
  | "review";

/** The HTTP status the server answered with, if it answered at all. */
export function httpStatusOf(error: unknown): number | null {
  if (error instanceof TRPCClientError) {
    const status = (error.data as { httpStatus?: unknown } | undefined)
      ?.httpStatus;
    if (typeof status === "number") return status;
  }
  return null;
}

/**
 * Whether the server answered at all.
 *
 * A request that never arrived is a *wait*, not a strike. Counting it against
 * the attempt limit means two minutes of bad supermarket wifi can mark a
 * genuine shop as exhausted without a single server having seen it.
 */
export function receivedResponse(error: unknown): boolean {
  return httpStatusOf(error) !== null;
}

/**
 * Procedures whose refusal is a disagreement about the world rather than about
 * the request.
 *
 * Only consumption has a floor to hit. A `CONFLICT` from anywhere else — a
 * replay record that belongs to another household, a swept claim — is a
 * genuine refusal with nothing for a person to reconcile.
 */
const RECONCILABLE = new Set(["inventory.consumeStock"]);

/**
 * Procedures whose NOT_FOUND is a question for a person rather than a dead end.
 *
 * Only `resolveScan` has one: a barcode Open Food Facts does not know is not a
 * failed request, it is one the person must name. Elsewhere a 404 on a queued
 * write is a genuine "gone" and stays permanent.
 */
const REVIEWABLE = new Set(["product.resolveScan"]);

/** Statuses that mean "the server is busy or the network is not", not "no". */
const RETRYABLE_STATUSES = new Set([408, 425, 429]);

export function classifyMutationError(
  error: unknown,
  path: string,
): MutationOutcome {
  const status = httpStatusOf(error);

  // No status at all: a dropped connection, a DNS failure, or a captive portal
  // returning HTML that the transformer could not parse. All of them are "we
  // never got through", and none of them is the server's opinion.
  if (status === null) return "transient";

  if (status === 401) return "auth";
  if (status >= 500) return "transient";
  if (RETRYABLE_STATUSES.has(status)) return "transient";

  if (status === 409 && RECONCILABLE.has(path)) return "reconcile";
  if (status === 404 && REVIEWABLE.has(path)) return "review";

  return "permanent";
}

/**
 * How many attempts *that reached a server* a change gets before it is called
 * exhausted. Transport failures are not counted; see `receivedResponse`.
 */
export const MAX_ATTEMPTS = 8;
