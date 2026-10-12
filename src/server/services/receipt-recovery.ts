import { type PrismaClient, ReceiptStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { describeError } from "@/server/log-error";

/**
 * The states only the upload's background work holds a receipt in.
 *
 * `receipt.upload` writes UPLOADING and hands the receipt to
 * `processReceiptAsync`, which moves it through PROCESSING (OCR) and PARSED
 * (lines saved, matching under way) to NEEDS_REVIEW, CONFIRMED or FAILED,
 * inside the process that took the upload. Nothing else moves a receipt out
 * of these three and nothing re-processes one, so a receipt found in one of
 * them that was created before this process started has no one left working
 * on it. The upload screen polls all three, so such a receipt spins there for
 * ever and offers no retry.
 *
 * PARSED is here although the audit named only the first two: it is as
 * transient as they are (`saveParsedItems` sets it and `matchReceiptItems`
 * replaces it in the same call chain) and a restart between them strands it
 * the same way.
 */
export const INTERRUPTIBLE_STATUSES = [
  ReceiptStatus.UPLOADING,
  ReceiptStatus.PROCESSING,
  ReceiptStatus.PARSED,
] as const;

/**
 * Moves every receipt a previous process left in flight to FAILED, which the
 * upload screen ends its polling on and offers a retry for.
 *
 * **Created before `startedBefore`, not merely in flight.** There is no
 * `updatedAt` on a receipt, and none is needed: every receipt this process
 * takes is created after it started, so the cutoff leaves alone anything this
 * process is still working on, however the sweep is scheduled against the
 * first requests. `createdAt` is filled by Prisma from this process's clock,
 * the same clock the cutoff is read from.
 *
 * @returns how many receipts it failed.
 */
export async function failInterruptedReceipts(
  startedBefore: Date,
  db: Pick<PrismaClient, "receipt"> = prisma,
): Promise<number> {
  const { count } = await db.receipt.updateMany({
    where: {
      status: { in: [...INTERRUPTIBLE_STATUSES] },
      createdAt: { lt: startedBefore },
    },
    data: { status: ReceiptStatus.FAILED },
  });
  return count;
}

/**
 * The start-up form of `failInterruptedReceipts`: logs what it did and never
 * throws. A database that is not up yet is a reason to log, not to keep the
 * server from starting — the receipts stay where they were until the next
 * start, which is how they were before this existed.
 */
export async function recoverInterruptedReceipts(
  startedBefore: Date,
  db: Pick<PrismaClient, "receipt"> = prisma,
): Promise<void> {
  try {
    const count = await failInterruptedReceipts(startedBefore, db);
    if (count > 0) {
      // There is no column for a failure reason; the log carries it.
      console.warn(
        `Marked ${count} receipt(s) FAILED: interrupted by a restart while being processed`,
      );
    }
  } catch (error) {
    // Through describeError like every other log of a Prisma failure: the
    // arguments here are only statuses and a date, but the rule is the
    // seam's, not each call site's judgement of its own arguments.
    console.error(
      "Could not fail receipts a restart interrupted:",
      describeError(error),
    );
  }
}
