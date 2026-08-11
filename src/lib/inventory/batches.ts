/**
 * What is actually left of each batch.
 *
 * Stock is an append-only ledger: a purchase is a positive `StockEntry`
 * carrying an expiry date, and a consumption is a *separate* negative entry
 * carrying none. Nothing links the two. So "how much of this batch is left" is
 * not stored anywhere and has to be derived, and the derivation needs a rule
 * for which batch a consumption came out of.
 *
 * **The rule is soonest-expiry-first.** Someone taking milk out of the fridge
 * reaches for the carton that has to go first, and that is also the assumption
 * that makes the kitchen screen useful rather than alarming: it stops a batch
 * that was drunk weeks ago from being reported as about to spoil.
 *
 * It is an assumption, and it is the honest one available. The alternative is
 * to attribute each consumption to a batch at the time it happens, which is a
 * schema change and a change to every write path (ISSUES.md INV-1 calls it
 * "a larger modelling change [that] should be a deliberate decision rather
 * than a side effect"). Until that decision is taken, this is stated here
 * rather than assumed silently in a router.
 *
 * Undated batches are drawn down last. A batch with no expiry date has no
 * urgency, so nobody reaches for it first, and putting it at the front would
 * make dated batches look fuller than they are — which is the direction of
 * error that matters.
 */

/** The fields of a `StockEntry` this calculation needs. */
export interface LedgerEntry {
  id: string;
  quantity: number;
  expirationDate: Date | null;
}

/**
 * Soonest expiry first; undated last; ties broken by id so the result does not
 * depend on the order the database happened to return rows in.
 */
function byExpiryThenId(a: LedgerEntry, b: LedgerEntry): number {
  if (a.expirationDate && b.expirationDate) {
    const difference = a.expirationDate.getTime() - b.expirationDate.getTime();
    if (difference !== 0) return difference;
  } else if (a.expirationDate) {
    return -1;
  } else if (b.expirationDate) {
    return 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * How much of each positive batch survives the household's consumption.
 *
 * Keyed by entry id. Batches drawn down to nothing are present with `0` rather
 * than absent, so a caller can tell "this batch is finished" from "there is no
 * such batch".
 *
 * `entries` must be one product's ledger, already scoped to whatever location
 * the caller cares about — consumption recorded against a location draws down
 * that location's batches, and mixing locations here would let stock consumed
 * in the kitchen erase a batch in the garage.
 */
export function remainingByBatch(
  entries: readonly LedgerEntry[],
): Map<string, number> {
  const batches = entries.filter((entry) => entry.quantity > 0).sort(byExpiryThenId);

  let drawdown = entries.reduce(
    (total, entry) => (entry.quantity < 0 ? total - entry.quantity : total),
    0,
  );

  const remaining = new Map<string, number>();
  for (const batch of batches) {
    const taken = Math.min(batch.quantity, drawdown);
    drawdown -= taken;
    // Floating point: 0.1 + 0.2 arrives here as 0.30000000000000004, and a
    // batch that should be empty would read as 4e-17 left and be reported as
    // expiring. Quantities are entered by people, to two decimals at most.
    remaining.set(batch.id, Math.round((batch.quantity - taken) * 100) / 100);
  }

  return remaining;
}

/**
 * The household's net stock of one product: everything in, minus everything
 * out. This is the figure `getStockOverview` shows, and the one the expiry
 * views must agree with.
 */
export function netStock(entries: readonly LedgerEntry[]): number {
  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  return Math.round(total * 100) / 100;
}

/** Whole days from `from` to `to`, rounded up. Negative when `to` has passed. */
export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}
