/** Only exact count conversions; a package's size cannot be inferred. */
export function countUnitSize(unit: string | null): number | undefined {
  switch ((unit ?? "").trim().toLowerCase()) {
    case "unidad": case "unidades": case "ud": case "uds": case "unit": case "units":
      return 1;
    case "docena": case "docenas": case "dozen": case "dozens":
      return 12;
    default:
      return undefined;
  }
}

export function unitConversion(from: string | null, to: string): number | undefined {
  if (from === to) return 1;
  const source = countUnitSize(from);
  const target = countUnitSize(to);
  return source !== undefined && target !== undefined ? source / target : undefined;
}

export function canonicalCount<T extends { quantity: number; unit: string }>(input: T): T {
  return countUnitSize(input.unit) === 12
    ? { ...input, quantity: input.quantity * 12, unit: "unidad" }
    : input;
}

export function canonicalProduct<T extends { defaultUnit?: string; minStock?: number | null }>(input: T): T {
  return input.defaultUnit && countUnitSize(input.defaultUnit) === 12
    ? { ...input, defaultUnit: "unidad", ...(input.minStock == null ? {} : { minStock: input.minStock * 12 }) }
    : input;
}
