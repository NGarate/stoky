import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CHART_TOOLTIP } from "@/lib/chart-tooltip";

/**
 * Every Recharts tooltip wears the tokens.
 *
 * Left at its defaults, a tooltip is a white box with each row written in its
 * series colour: 2.17–4.42:1 on the price chart, 1.59:1 for the stock
 * history's mint at night. A new chart that forgets is the same defect
 * again, so this is a scan rather than a test per chart.
 */
const SRC = join(import.meta.dir, "..", "..");

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.includes("__tests__")) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

describe("chart tooltips", () => {
  it("are ink on a card, never a series colour on white", () => {
    expect(CHART_TOOLTIP.contentStyle.backgroundColor).toBe("var(--card)");
    expect(CHART_TOOLTIP.itemStyle.color).toBe("var(--foreground)");
    expect(CHART_TOOLTIP.labelStyle.color).toBe("var(--foreground)");
  });

  it("are used by every chart that draws one", () => {
    const charts = sourceFiles(SRC).filter((path) => {
      const source = readFileSync(path, "utf8");
      return /from "recharts"/.test(source) && /<Tooltip\b/.test(source);
    });
    expect(charts.length).toBeGreaterThan(0);

    const bare = charts
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        const tooltips = source.match(/<Tooltip\b[^>]*>/g) ?? [];
        return tooltips.some((tag) => !tag.includes("{...CHART_TOOLTIP}"));
      })
      .map((path) => relative(SRC, path));

    expect(bare).toEqual([]);
  });
});
