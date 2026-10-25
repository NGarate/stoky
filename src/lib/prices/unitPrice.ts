import { unitConversion } from "@/lib/inventory/units";

/**
 * What one unit cost.
 *
 * A `PriceRecord`'s `price` is the total paid for `quantity` units — the
 * receipt pipeline writes a line total with its parsed quantity, and
 * `addStock` asks for "lo que has pagado en total por esta cantidad". Every
 * comparison therefore has to divide, and comparing the raw `price` made a
 * six-pack at 5,34 € read as five times dearer than one carton at 0,99 €.
 *
 * Null when there is no usable quantity: such a row cannot be compared with
 * anything, so callers leave it out rather than invent a figure for it.
 */
export function unitPrice(price: number, quantity: number): number | null {
  return quantity > 0 && Number.isFinite(price / quantity)
    ? price / quantity
    : null;
}

/**
 * The records restated in one unit, so their unit prices can be compared.
 *
 * A product's sightings need not share a unit: the schema takes any, and
 * `addStock` used to write whatever the form held. Dividing each by its own
 * quantity then compares euros per gram with euros per kilo — 1 € for 500 g
 * came out a thousand times cheaper than 2 € for 1 kg, which is the same
 * price. Each record's quantity is converted to `unit` instead, and a record
 * that cannot be is left out, for the reason stock is refused rather than
 * summed in that case (`src/lib/inventory/units.ts` only converts what is
 * exact). `price` is untouched: it is still what was paid.
 */
export function inUnit<T extends { quantity: number; unit: string }>(
  records: readonly T[],
  unit: string,
): T[] {
  return records.flatMap((record) => {
    const factor = unitConversion(record.unit, unit);
    return factor === undefined
      ? []
      : [{ ...record, quantity: record.quantity * factor, unit }];
  });
}

/** `record` with its unit price beside it, or null when it has none. */
export function withUnitPrice<T extends { price: number; quantity: number }>(
  record: T,
): (T & { unitPrice: number }) | null {
  const value = unitPrice(record.price, record.quantity);
  return value === null ? null : { ...record, unitPrice: value };
}

/** Keeps only the records that have a unit price, and attaches it. */
export function withUnitPrices<T extends { price: number; quantity: number }>(
  records: readonly T[],
): Array<T & { unitPrice: number }> {
  return records.flatMap((record) => {
    const priced = withUnitPrice(record);
    return priced ? [priced] : [];
  });
}

/** One point of the price chart: a unit price, when and where it was seen. */
export function toChartPoints(
  history: ReadonlyArray<{
    recordedAt: Date;
    unitPrice: number;
    store: { name: string };
  }>,
): Array<{ date: string; price: number; storeName: string }> {
  return history.map((record) => ({
    date: record.recordedAt.toISOString(),
    price: record.unitPrice,
    storeName: record.store.name,
  }));
}
