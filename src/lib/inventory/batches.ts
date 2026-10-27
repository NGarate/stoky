import { Decimal } from "@prisma/client-runtime-utils";

/** A movement can identify its source batch; older movements may not. */
export interface LedgerEntry {
  id: string;
  quantity: Decimal;
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
export function remainingByBatch(
  entries: readonly LedgerEntry[],
): Map<string, Decimal | null> {
  const remaining = new Map<string, Decimal | null>();
  const batches = new Map<string, LedgerEntry>();
  // Stable sorting preserves the supplied order when timestamps tie. Untimed
  // callers supply purchases first, then withdrawals.
  const ordered = [...entries].sort(
    (a, b) =>
      (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
      Number(b.quantity.greaterThan(0)) - Number(a.quantity.greaterThan(0)),
  );
  for (const entry of ordered) {
    if (entry.quantity.isZero()) continue;
    if (entry.quantity.greaterThan(0)) {
      batches.set(entry.id, entry);
      remaining.set(entry.id, entry.quantity);
      continue;
    }
    const candidates = [...batches.values()].filter(
      (batch) =>
        !remaining.get(batch.id)?.isZero() &&
        (entry.batchId
          ? batch.id === entry.batchId
          : !entry.locationId || batch.locationId === entry.locationId),
    );
    if (candidates.length === 1) {
      const id = candidates[0]!.id;
      const previous = remaining.get(id);
      remaining.set(
        id,
        previous == null ? null : Decimal.max(0, previous.plus(entry.quantity)),
      );
    } else {
      for (const batch of candidates) remaining.set(batch.id, null);
    }
  }
  // A completely depleted product has no surviving batch, whichever one was
  // used first. This does not assign an unknown withdrawal to a particular lot.
  if (netStock(entries).isZero()) {
    for (const id of remaining.keys()) remaining.set(id, new Decimal(0));
  }
  return remaining;
}

/**
 * Which batches at `locationId` a move of `quantity` comes out of: soonest
 * expiry first (FEFO), undated last, oldest purchase breaking ties.
 *
 * This is a choice being *made and recorded* — each part becomes a movement
 * carrying its `batchId` — not an inference about what was used, which
 * `remainingByBatch` refuses to make. Only batches whose remainder is known
 * are drawn from; whatever is left over is `unassigned`, and the caller moves
 * it without a batch, as every movement was moved before batches existed.
 */
export function allocateFefo<T extends LedgerEntry>(
  entries: readonly T[],
  locationId: string,
  quantity: Decimal,
): { parts: Array<{ batch: T; quantity: Decimal }>; unassigned: Decimal } {
  const remaining = remainingByBatch(entries);
  const candidates = entries
    .filter(
      (entry) =>
        entry.quantity.greaterThan(0) &&
        entry.locationId === locationId &&
        !!remaining.get(entry.id)?.greaterThan(0),
    )
    .sort(
      (a, b) =>
        (a.expirationDate?.getTime() ?? Infinity) -
          (b.expirationDate?.getTime() ?? Infinity) ||
        (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
    );

  const parts: Array<{ batch: T; quantity: Decimal }> = [];
  let left = quantity;
  for (const batch of candidates) {
    if (!left.greaterThan(0)) break;
    const take = Decimal.min(remaining.get(batch.id) ?? 0, left);
    parts.push({ batch, quantity: take });
    left = left.minus(take);
  }
  return { parts, unassigned: Decimal.max(0, left) };
}

export function netStock(entries: readonly LedgerEntry[]): Decimal {
  return Decimal.sum(0, ...entries.map((entry) => entry.quantity));
}

/**
 * Expiry is a calendar date, not an instant.
 *
 * The date picker's "2026-10-06" reaches the server as `new Date(…)` of that
 * string, which is UTC midnight, and was compared with `new Date()`: milk good
 * until the 6th was listed as expired from 02:00 on the 6th in Madrid. So an
 * expiry date is read as the day its UTC date parts name, and "today" is the
 * date on the household's calendar. There is no per-household or per-user
 * time zone in the schema; the application is Spanish-first, so Madrid's
 * calendar is the one used.
 */
export const EXPIRY_TIME_ZONE = "Europe/Madrid";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day an expiry date names, as UTC midnight. */
function dayOf(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Today on the household's calendar, as UTC midnight of that date — the same
 * representation an expiry date is stored in, so the two compare directly.
 */
export function startOfToday(
  now: Date = new Date(),
  timeZone: string = EXPIRY_TIME_ZONE,
): Date {
  // Parts, not a formatted string, so no locale is chosen for anyone; the
  // calendar and digits are pinned instead, which is what the arithmetic needs.
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}

/**
 * Whole calendar days from `today` (from `startOfToday`) to the day `expiry`
 * names: 0 on the day itself, 1 tomorrow, negative once it has passed. Days
 * elapsed are this negated — one measurement, not a second one rounded the
 * other way.
 */
export function daysUntilExpiry(expiry: Date, today: Date): number {
  return Math.round((dayOf(expiry) - dayOf(today)) / DAY_MS);
}

/**
 * How close an expiry has to be before it needs attention: today and the next
 * three days. The server's `isExpiringSoon`, the kitchen's "Usar ya" and
 * `ExpiryStatus`'s warn tone are one threshold, so they read it from here.
 */
export const EXPIRING_SOON_DAYS = 3;

/** The first instant after the day `days` days after `today`. */
export function endOfDayAfter(today: Date, days: number): Date {
  return new Date(dayOf(today) + (days + 1) * DAY_MS);
}
