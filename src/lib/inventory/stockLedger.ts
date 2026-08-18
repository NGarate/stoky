/**
 * Running stock totals for the history chart (Phase 8 item 5).
 *
 * `inventory.getStockHistory` returns a signed ledger, newest first and
 * cursor-paginated. A running sum computed forwards from a partial page would
 * be wrong at the tail, so this walks *backwards* from the one number known to
 * be true — the product's current net stock: the total after the newest entry
 * is the net itself, and each older entry's total is the one after it minus
 * the newer entry's delta. Loading more pages extends the line; it never
 * changes a point already drawn.
 */
export interface LedgerEntry {
  id: string;
  quantity: number;
  createdAt: Date | string;
}

export interface LedgerPoint extends LedgerEntry {
  /** Net stock immediately after this entry was written. */
  total: number;
}

export function runningTotals(
  newestFirst: LedgerEntry[],
  netNow: number,
): LedgerPoint[] {
  const points: LedgerPoint[] = [];
  let total = netNow;
  for (const entry of newestFirst) {
    points.push({ ...entry, total });
    total -= entry.quantity;
  }
  return points;
}
