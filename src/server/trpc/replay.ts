import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Applying a queued mutation once, however many times it arrives.
 *
 * A shop composed in aeroplane mode is sent when the signal returns, and the
 * send can repeat: the reply was lost, the tab was closed mid-flight, the queue
 * was drained twice. "Consume one litre" replayed twice must consume one litre.
 *
 * **One transaction, and the primary key is the lock.** The claim row and the
 * effect are written together, so a crash rolls both back and there is no
 * in-flight state, no lease and nothing to reap. The alternative — claim, then
 * apply, then settle — has a window in which the key is taken and the effect is
 * missing, and every recovery story for that window is worse than not having
 * it. Here "claimed but not applied" is unrepresentable.
 *
 * This is a plain function called inside a resolver rather than a tRPC
 * middleware, for two reasons that were measured rather than assumed. A
 * middleware cannot short-circuit without `middlewareMarker`, which
 * `@trpc/server@11.18.0` exports only from `unstable-core-do-not-import`. And
 * `.input()` appends its parser as a middleware in declaration order, so a
 * `.use()` attached to a base procedure tier runs *before* Zod — the key would
 * be read unvalidated, which is the opposite of the point.
 */

/** Keys that describe the delivery of a mutation, not the mutation. */
const ENVELOPE_KEYS = ["idempotencyKey", "composedByUserId"] as const;

/** How long a claim is remembered. */
export const REPLAY_RETENTION_DAYS = 7;

/** Bounds for the transaction, rather than Prisma's 2s/5s defaults. */
const TRANSACTION_BOUNDS = { maxWait: 5_000, timeout: 10_000 } as const;

/**
 * Prisma codes that mean "the database was busy", not "the request was wrong".
 *
 * A drained queue can arrive as one batch, tRPC runs a batch under
 * `Promise.all`, and each replayable call opens an interactive transaction —
 * so pool exhaustion is a routine outcome of the very thing this file exists
 * for. Reported as 408 so the queue retries it, rather than as a 500 the client
 * would classify as permanent and discard the shop for.
 */
const BUSY_CODES = new Set(["P2024", "P2028", "P2034"]);

/** Thrown inside the transaction when the key was already used. */
class KeyAlreadyClaimed extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function isBusy(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    BUSY_CODES.has(error.code)
  );
}

/**
 * A value in a form that hashes the same however it was built.
 *
 * Object keys are sorted, `undefined` is dropped — a field omitted and a field
 * explicitly undefined are the same request — and a `Date` becomes a tagged
 * instant rather than a bare string, so a date field cannot collide with a
 * text field that happens to hold the same characters. Dates matter here
 * concretely: `stockEntrySchema.expirationDate` is `z.date()`.
 */
function canonicaliseValue(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonicaliseValue);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = canonicaliseValue(source[key]);
    }
    return out;
  }
  return value;
}

/**
 * The request as it will be hashed: canonical, and **without the envelope**.
 *
 * Stripping the key is not tidiness, it is the whole binding. Hash the key in
 * and every request is unique by construction, so "same key, different body"
 * can never be detected and the replay check silently becomes a no-op.
 */
export function canonicalise(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return canonicaliseValue(input);
  }
  const rest: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const key of ENVELOPE_KEYS) delete rest[key];
  return canonicaliseValue(rest);
}

/** A stable fingerprint of "this procedure, called with this body". */
export function requestHash(procedure: string, input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify([procedure, canonicalise(input)]))
    .digest("hex");
}

export interface ReplayContext {
  db: PrismaClient;
  session: { user: { id: string } };
  householdId: string;
}

export interface WithReplayOptions<T> {
  /** The device-minted key, already validated by `replayable`. */
  key: string;
  /** The account the device says composed this. Compared with the session. */
  composedByUserId: string;
  /** The tRPC path, e.g. `"inventory.consumeStock"`. Part of the fingerprint. */
  procedure: string;
  /** The full input. The envelope is stripped before hashing. */
  input: unknown;
  /** The mutation itself, against the transaction client. */
  apply: (tx: Prisma.TransactionClient) => Promise<T>;
  /** The ids worth remembering so a replay can answer from the database. */
  ids: (result: T) => string[];
  /** How to rebuild the answer on a replay. Runs outside the transaction. */
  reread: (db: PrismaClient, ids: string[]) => Promise<T>;
}

export async function withReplay<T>(
  ctx: ReplayContext,
  options: WithReplayOptions<T>,
): Promise<T> {
  const userId = ctx.session.user.id;

  if (options.composedByUserId !== userId) {
    // Before anything is claimed or written. A queue that survived a change of
    // account on a shared device must not apply under the new one.
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This change was composed by a different account",
    });
  }

  const hash = requestHash(options.procedure, options.input);
  const expiresAt = new Date(
    Date.now() + REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  try {
    return await ctx.db.$transaction(async (tx) => {
      try {
        await tx.mutationReplay.create({
          data: {
            key: options.key,
            userId,
            householdId: ctx.householdId,
            procedure: options.procedure,
            requestHash: hash,
            resultIds: [],
            expiresAt,
          },
        });
      } catch (error) {
        // Distinguished here rather than in the outer catch, so a unique
        // violation raised by `apply` — a real domain conflict — is never
        // mistaken for a replay and answered with someone else's result.
        if (isUniqueViolation(error)) throw new KeyAlreadyClaimed();
        throw error;
      }

      const result = await options.apply(tx);

      await tx.mutationReplay.update({
        where: { userId_key: { userId, key: options.key } },
        data: { resultIds: options.ids(result) },
      });

      return result;
    }, TRANSACTION_BOUNDS);
  } catch (error) {
    if (error instanceof KeyAlreadyClaimed) {
      return answerFromRecord(ctx, options, hash);
    }
    if (isBusy(error)) {
      throw new TRPCError({
        code: "TIMEOUT",
        message: "The server was busy. This change has not been lost.",
      });
    }
    // Everything else arrives as itself. A resolver's CONFLICT must not become
    // a 500 on the way out, or the queue classifies it as retryable and spends
    // eight attempts on a refusal that will never change its mind.
    throw error;
  } finally {
    await sweepExpired(ctx.db, userId);
  }
}

/**
 * What a replay is answered with.
 *
 * The re-read uses the root client, not the transaction: an interactive
 * transaction is dead after a failed statement, and the claim insert is exactly
 * that. It also returns rows as they are *now* and as this caller may see them
 * — so a row deleted since the first apply yields an honest absence rather than
 * a preserved ghost.
 */
async function answerFromRecord<T>(
  ctx: ReplayContext,
  options: WithReplayOptions<T>,
  hash: string,
): Promise<T> {
  const record = await ctx.db.mutationReplay.findUnique({
    where: { userId_key: { userId: ctx.session.user.id, key: options.key } },
  });

  if (!record) {
    // The row was swept between the failed insert and this read. Nothing can be
    // answered honestly, and re-running would risk applying twice.
    throw new TRPCError({
      code: "CONFLICT",
      message: "This change is no longer on record. Send it again.",
    });
  }

  if (record.procedure !== options.procedure || record.requestHash !== hash) {
    // A key reused with a different body. Nothing runs and nothing is read
    // out: answering with the first call's result would be a way to read a
    // row by guessing a key.
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This key was already used for a different change",
    });
  }

  if (record.householdId !== ctx.householdId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This change belongs to a different household",
    });
  }

  return options.reread(ctx.db, record.resultIds);
}

/**
 * Retention, without a scheduler.
 *
 * A self-hosted box has no cron and should not grow an unauthenticated cleanup
 * endpoint to defend. Each caller clears its own expired rows on the way out;
 * it is bounded work on an indexed column, and it cannot fail the mutation that
 * has already committed.
 */
async function sweepExpired(db: PrismaClient, userId: string): Promise<void> {
  try {
    await db.mutationReplay.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });
  } catch {
    // Housekeeping. A failure here must never turn a successful write into an
    // error the client will retry.
  }
}
