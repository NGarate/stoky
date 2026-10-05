import { useTranslations } from "next-intl";

import { countUnitSize } from "@/lib/inventory/units";

/**
 * How an amount and its unit are written on screen.
 *
 * The count unit is *stored* as the English token `"unit"` — the schema's
 * default, the new-product form's prefill, Open Food Facts' fallback, the
 * receipt pipeline's — and "unidad" where a dozen was folded into units. The
 * screens printed whatever was stored, after the number and never
 * pluralised: "24 unidad", "He usado 1 unit", "0 unit" in a Spanish
 * interface. The data is right; it is a token, not a word. This is where the
 * token becomes a word.
 *
 * Only count units are translated (`countUnitSize(unit) === 1`): "unit",
 * "units", "unidad", "unidades", "ud", "uds". Everything else is something a
 * person typed — "kg", "L", "paquete" — and is shown as they typed it, since
 * the application cannot know how to decline a word it did not write.
 */

/** `useTranslations("common")`, or anything with its shape. */
export type CountTranslator = (
  key: "unitCount",
  values: { count: number },
) => string;

/** The unit's word for `count` of it, or the unit exactly as stored. */
export function displayUnit(
  t: CountTranslator,
  unit: string | null | undefined,
  count: number,
): string {
  if (!unit) return "";
  return countUnitSize(unit) === 1 ? t("unitCount", { count }) : unit;
}

/** "24 unidades", "1 unit", "1.5 kg" — the number, then its unit. */
export function formatQuantity(
  t: CountTranslator,
  quantity: number,
  unit: string | null | undefined,
): string {
  const word = displayUnit(t, unit, quantity);
  return word ? `${quantity} ${word}` : String(quantity);
}

/**
 * The same, for a queued change's label.
 *
 * A snackbar or the unsaved-changes list renders `{ key, values }` long after
 * the change was composed, so the unit inside `values` is still the stored
 * token. Its count is the number the sentence puts in front of it: the
 * label's `quantity` ("Usaste 2 unidades"), or its `stock` for an adjustment
 * ("queda en 5 unidades").
 */
export function displayLabelValues<T extends Record<string, unknown>>(
  t: CountTranslator,
  values: T | undefined,
): T | undefined {
  if (!values || typeof values.unit !== "string") return values;
  const count =
    typeof values.quantity === "number"
      ? values.quantity
      : typeof values.stock === "number"
        ? values.stock
        : 1;
  return { ...values, unit: displayUnit(t, values.unit, count) };
}

/**
 * The three, bound to the reader's language.
 *
 * `measure` is a unit named as a scale rather than counted — "escribe el
 * total, en unidades", "¿cuánto hay ahora (unidades)?" — which reads as the
 * plural in both languages.
 */
export function useQuantityFormat(): {
  unit: (unit: string | null | undefined, count: number) => string;
  measure: (unit: string | null | undefined) => string;
  quantity: (quantity: number, unit: string | null | undefined) => string;
  labelValues: <T extends Record<string, unknown>>(values: T | undefined) => T | undefined;
} {
  const t = useTranslations("common") as unknown as CountTranslator;
  return {
    unit: (unit, count) => displayUnit(t, unit, count),
    measure: (unit) => displayUnit(t, unit, 2),
    quantity: (quantity, unit) => formatQuantity(t, quantity, unit),
    labelValues: (values) => displayLabelValues(t, values),
  };
}
