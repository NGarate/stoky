import { describe, it, expect } from "bun:test";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";

/**
 * The defect this replaces is not untidiness. Sixteen call sites wrote
 * `€{n.toFixed(2)}`, which produces "€1.19" — symbol first, decimal point —
 * in an application whose primary language writes "1,19 €".
 */
describe("formatMoney", () => {
  it("writes euros the way Spanish writes them", () => {
    const formatted = formatMoney("es", 1.19, "EUR");

    // Not "€1.19". The symbol follows the number and the decimal is a comma.
    expect(formatted).toContain("1,19");
    expect(formatted).toContain("€");
    expect(formatted.indexOf("€")).toBeGreaterThan(formatted.indexOf("1,19"));
  });

  it("writes them the way English does, in English", () => {
    const formatted = formatMoney("en", 1.19, "EUR");

    expect(formatted).toContain("1.19");
    expect(formatted.indexOf("€")).toBeLessThan(formatted.indexOf("1.19"));
  });

  it("always shows both decimals, so 1 euro is not «1 €»", () => {
    expect(formatMoney("es", 1, "EUR")).toContain("1,00");
  });

  it("survives a currency code Intl rejects, because the number still matters", () => {
    // The column is free text with a default; a row written by something
    // other than this app can hold anything, and a RangeError here would
    // take down the whole page over one bad row.
    const formatted = formatMoney("es", 1.19, "not-a-currency");

    expect(formatted).toContain("1.19");
    expect(formatted).toContain("not-a-currency");
  });

  it("names the schema default rather than hiding it in a signature", () => {
    expect(DEFAULT_CURRENCY).toBe("EUR");
  });
});
