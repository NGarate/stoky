/**
 * Recharts' tooltip, in the application's tokens.
 *
 * Its defaults are a white box (`#fff`) with each row's text painted in that
 * series' stroke colour. A series colour is audited for telling lines apart,
 * not for being read: on the white box the price chart's hues measured
 * 2.17–4.42:1, and at night the stock history's mint `--gauge` on a white
 * box was 1.59:1. Every chart passes these three props instead, so the
 * box is a card and every glyph in it is `foreground` — pairs
 * `check-contrast.ts` already measures.
 */
export const CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: "var(--card)",
    borderColor: "var(--border)",
    color: "var(--foreground)",
  },
  itemStyle: { color: "var(--foreground)" },
  labelStyle: { color: "var(--foreground)" },
} as const;
