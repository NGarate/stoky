import { Prisma, type StockOperation } from "@/generated/prisma/client";

/** Where a withdrawal may draw from: one batch, one shelf, or anywhere. */
export interface Source {
  batchId?: string;
  locationId?: string | null;
}

/** One batch, and how much of `quantity` comes out of it. */
export interface Part {
  batch: { id: string; locationId: string | null; expirationDate: Date | null };
  quantity: Prisma.Decimal;
}

/**
 * Which batches `quantity` comes out of: soonest expiry first (FEFO), undated
 * last, oldest purchase breaking ties. Null when they do not hold that much.
 *
 * Reads the stored balances, so it runs in the transaction that writes the
 * withdrawal, after the product row is held (`SELECT … FOR UPDATE`, which
 * every movement of a product takes). Without the lock two withdrawals read
 * the same balance and both take it; the table's CHECK constraint would then
 * refuse the second, but as a 500 rather than a CONFLICT.
 */
export async function allocate(
  tx: Prisma.TransactionClient,
  productId: string,
  quantity: Prisma.Decimal,
  source: Source = {},
): Promise<Part[] | null> {
  const batches = await tx.stockEntry.findMany({
    where: {
      productId,
      remaining: { gt: 0 },
      ...(source.batchId && { id: source.batchId }),
      ...(source.locationId && { locationId: source.locationId }),
    },
    orderBy: [
      { expirationDate: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      locationId: true,
      expirationDate: true,
      remaining: true,
    },
  });

  const parts: Part[] = [];
  let left = quantity;
  for (const { remaining, ...batch } of batches) {
    if (!left.greaterThan(0)) break;
    // `remaining: { gt: 0 }` above, so never null here.
    const take = Prisma.Decimal.min(remaining!, left);
    parts.push({ batch, quantity: take });
    left = left.minus(take);
  }
  return left.greaterThan(0) ? null : parts;
}

/**
 * Writes a withdrawal: per batch drawn on, a negative row naming it, at its
 * location, and the batch's balance lowered by the same amount.
 */
export async function withdraw(
  tx: Prisma.TransactionClient,
  parts: readonly Part[],
  movement: {
    productId: string;
    unit: string;
    operationType: StockOperation;
    note?: string | null;
    createdBy: string;
  },
) {
  const entries = [];
  for (const { batch, quantity } of parts) {
    await tx.stockEntry.update({
      where: { id: batch.id },
      data: { remaining: { decrement: quantity } },
    });
    entries.push(
      await tx.stockEntry.create({
        data: {
          ...movement,
          quantity: quantity.negated(),
          batchId: batch.id,
          locationId: batch.locationId,
        },
        include: { product: true, location: true },
      }),
    );
  }
  return entries;
}
