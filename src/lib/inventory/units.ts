import type { Decimal } from "@prisma/client-runtime-utils";

/** Only exact count conversions; a package's size cannot be inferred. */
export function countUnitSize(unit: string | null): number | undefined {
  switch ((unit ?? "").trim().toLowerCase()) {
    case "unidad":
    case "unidades":
    case "ud":
    case "uds":
    case "unit":
    case "units":
      return 1;
    case "docena":
    case "docenas":
    case "dozen":
    case "dozens":
      return 12;
    default:
      return undefined;
  }
}

/** Case and surrounding space do not make a different unit: "L" is "l". */
export function unitConversion(
  from: string | null,
  to: string,
): number | undefined {
  if (
    from === to ||
    (from ?? "").trim().toLowerCase() === to.trim().toLowerCase()
  )
    return 1;
  const source = countUnitSize(from);
  const target = countUnitSize(to);
  return source !== undefined && target !== undefined
    ? source / target
    : undefined;
}

export function canonicalCount<T extends { quantity: Decimal; unit: string }>(
  input: T,
): T {
  return countUnitSize(input.unit) === 12
    ? { ...input, quantity: input.quantity.times(12), unit: "unidad" }
    : input;
}

export function canonicalProduct<
  T extends { defaultUnit?: string; minStock?: Decimal | null },
>(input: T): T {
  return input.defaultUnit && countUnitSize(input.defaultUnit) === 12
    ? {
        ...input,
        defaultUnit: "unidad",
        ...(input.minStock == null
          ? {}
          : { minStock: input.minStock.times(12) }),
      }
    : input;
}

/**
 * Whether a shopping item's amount is in its product's unit, and so adds to
 * what the household's lists already cover. No unit means the product's.
 *
 * Exact rather than through `unitConversion`, because the stock overview asks
 * the same question in SQL (`inventory.ts`, `"onList"`) and the two must not
 * disagree; `shopping.addItem` stores a convertible amount in the product's
 * unit, so only an unconvertible one — "500 g" of rice counted in kg — is
 * left out, rather than read as 500 kg.
 */
export function isProductUnit(
  unit: string | null,
  productUnit: string,
): boolean {
  return (
    unit === null ||
    unit.trim().toLowerCase() === productUnit.trim().toLowerCase()
  );
}
