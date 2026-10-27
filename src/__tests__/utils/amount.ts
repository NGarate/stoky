import { Decimal } from "@prisma/client-runtime-utils";

/**
 * A stored amount as a plain number, for an assertion.
 *
 * Quantities and money come back as `Decimal`, and `expect(decimal).toBe(2)`
 * compares an object with a number. Null and undefined pass through, so a
 * test that expects "no amount" still says so.
 */
export function num<T extends { toNumber(): number } | null | undefined>(
  value: T,
): T extends { toNumber(): number } ? number : T {
  return (value == null ? value : value.toNumber()) as never;
}

/**
 * A mocked row with `fields` turned into Decimals, as the server sends them.
 * For factories whose overrides are written as plain numbers; a field that
 * is null, absent or already a Decimal is left alone.
 */
export function asStored<T extends Record<string, unknown>>(
  row: T,
  ...fields: string[]
): T {
  const stored: Record<string, unknown> = { ...row };
  for (const field of fields) {
    const value = stored[field];
    if (typeof value === "number") stored[field] = new Decimal(value);
  }
  return stored as T;
}
