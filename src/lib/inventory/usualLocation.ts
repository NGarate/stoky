/**
 * Where a product usually goes, read from its own ledger.
 *
 * The add form's location default (Phase 8 item 3): most products go where
 * they always went, so the picker starts on the most frequent location among
 * the product's *incoming* entries — a consumption's location says where
 * something was taken from, not where it lives. A tie goes to the habit most
 * recently exercised, and no usable history returns `undefined`, which the
 * form treats exactly like the old default: no particular location.
 *
 * Pure and synchronous on purpose: `product.getById` already returns every
 * entry with its location, so the derivation costs no new query — and a pure
 * function is what the unit suite can hold to its three rules.
 */
export interface LocatedEntry {
  locationId: string | null;
  quantity: number;
  createdAt: Date | string;
}

export function usualLocationId(entries: LocatedEntry[]): string | undefined {
  const habits = new Map<string, { count: number; latest: number }>();

  for (const entry of entries) {
    if (entry.quantity <= 0 || !entry.locationId) continue;
    const at = new Date(entry.createdAt).getTime();
    const habit = habits.get(entry.locationId) ?? {
      count: 0,
      latest: -Infinity,
    };
    habits.set(entry.locationId, {
      count: habit.count + 1,
      latest: Math.max(habit.latest, at),
    });
  }

  let best: string | undefined;
  let bestCount = 0;
  let bestLatest = -Infinity;
  for (const [locationId, { count, latest }] of habits) {
    if (count > bestCount || (count === bestCount && latest > bestLatest)) {
      best = locationId;
      bestCount = count;
      bestLatest = latest;
    }
  }
  return best;
}
