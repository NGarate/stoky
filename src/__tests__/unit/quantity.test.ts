import { describe, it, expect } from "bun:test";
import { createTranslator } from "next-intl";
import es from "../../../messages/es.json";
import en from "../../../messages/en.json";
import {
  displayLabelValues,
  displayUnit,
  formatQuantity,
  type CountTranslator,
} from "@/lib/inventory/quantity";

/**
 * The count unit is stored as the token "unit" and was printed as stored:
 * "24 unidad", "He usado 1 unit", "0 unit" in a Spanish interface. These use
 * the real catalogues, so a reworded or missing `common.unitCount` fails here.
 */
const tEs = createTranslator({
  locale: "es",
  messages: es,
  namespace: "common",
}) as unknown as CountTranslator;
const tEn = createTranslator({
  locale: "en",
  messages: en,
  namespace: "common",
}) as unknown as CountTranslator;

describe("formatQuantity", () => {
  it("writes the stored count token as a word, pluralised", () => {
    expect(formatQuantity(tEs, 24, "unit")).toBe("24 unidades");
    expect(formatQuantity(tEs, 1, "unit")).toBe("1 unidad");
    expect(formatQuantity(tEs, 0, "unit")).toBe("0 unidades");
    expect(formatQuantity(tEn, 1, "unit")).toBe("1 unit");
    expect(formatQuantity(tEn, 3, "unit")).toBe("3 units");
  });

  it("treats every spelling of a count unit as the same unit", () => {
    for (const stored of [
      "unit",
      "units",
      "unidad",
      "unidades",
      "ud",
      "uds",
      " Unidad ",
    ]) {
      expect(formatQuantity(tEs, 2, stored)).toBe("2 unidades");
    }
  });

  it("leaves a unit a person typed exactly as they typed it", () => {
    expect(formatQuantity(tEs, 1.5, "kg")).toBe("1.5 kg");
    expect(formatQuantity(tEs, 2, "paquete")).toBe("2 paquete");
    expect(formatQuantity(tEs, 6, "L")).toBe("6 L");
  });

  it("writes a bare number when there is no unit at all", () => {
    expect(formatQuantity(tEs, 3, null)).toBe("3");
    expect(displayUnit(tEs, "", 3)).toBe("");
  });
});

describe("displayLabelValues", () => {
  it("translates a queued label's unit by its own quantity", () => {
    expect(
      displayLabelValues(tEs, { quantity: 1, unit: "unit", name: "Huevos" }),
    ).toEqual({ quantity: 1, unit: "unidad", name: "Huevos" });
    expect(displayLabelValues(tEn, { quantity: 4, unit: "unidad" })?.unit).toBe(
      "units",
    );
  });

  it("counts an adjustment's unit by the stock it lands on", () => {
    // products.adjust.saved: "«{name}» queda en {stock} {unit}".
    expect(
      displayLabelValues(tEs, { stock: 5, unit: "unit", name: "x" })?.unit,
    ).toBe("unidades");
  });

  it("leaves a label without a unit alone", () => {
    const values = { name: "Leche" };
    expect(displayLabelValues(tEs, values)).toBe(values);
    expect(displayLabelValues(tEs, undefined)).toBeUndefined();
  });
});
