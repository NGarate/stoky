/** A movement can identify its source batch; older movements may not. */
export interface LedgerEntry {
  id: string;
  quantity: number;
  expirationDate: Date | null;
  batchId?: string | null;
  locationId?: string | null;
  createdAt?: Date;
}

/**
 * Remaining quantities supported by the ledger. Null means the source of a
 * withdrawal is ambiguous. Expiry order is never evidence of what was used.
 * A location-only withdrawal can be resolved when just one batch existed there.
 */
export function remainingByBatch(entries: readonly LedgerEntry[]): Map<string, number | null> {
  const remaining = new Map<string, number | null>();
  const batches = new Map<string, LedgerEntry>();
  // Stable sorting preserves the supplied order when timestamps tie. Untimed
  // callers supply purchases first, then withdrawals.
  const ordered = [...entries].sort((a, b) =>
    (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
    Number(b.quantity > 0) - Number(a.quantity > 0),
  );
  for (const entry of ordered) {
    if (entry.quantity > 0) {
      batches.set(entry.id, entry);
      remaining.set(entry.id, entry.quantity);
      continue;
    }
    if (entry.quantity === 0) continue;
    const candidates = [...batches.values()].filter((batch) =>
      remaining.get(batch.id) !== 0 &&
      (entry.batchId ? batch.id === entry.batchId :
        !entry.locationId || batch.locationId === entry.locationId),
    );
    if (candidates.length === 1) {
      const id = candidates[0]!.id;
      const previous = remaining.get(id);
      remaining.set(id, previous == null ? null :
        Math.max(0, Math.round((previous + entry.quantity) * 100) / 100));
    } else {
      for (const batch of candidates) remaining.set(batch.id, null);
    }
  }
  // A completely depleted product has no surviving batch, whichever one was
  // used first. This does not assign an unknown withdrawal to a particular lot.
  if (netStock(entries) === 0) {
    for (const id of remaining.keys()) remaining.set(id, 0);
  }
  return remaining;
}

export function netStock(entries: readonly LedgerEntry[]): number {
  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  return Math.round(total * 100) / 100;
}

/** Whole days from `from` to `to`, rounded up. Negative when `to` has passed. */
export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}
